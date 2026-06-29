import type { Command } from 'commander';
import * as p from '@clack/prompts';
import { ApiextensionsV1Api, CoreV1Api, RbacAuthorizationV1Api, StorageV1Api, type KubeConfig } from '@kubernetes/client-node';
import { APP_NAMESPACE, APP_CLUSTER_RESOURCE_PREFIX, CNPG_CRD_GROUP_SUFFIX, HELM_RELEASE_NAME, WORKER_MANAGED_BY_SELECTOR } from '~/lib/constants.js';
import { getClusterInfo, loadKubeConfig } from '~/lib/k8s.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';
import { helmUninstall, listReleaseNames } from '~/lib/helm.js';
import { UserCancelledError, printAndExit } from '~/lib/errors.js';
import { CSI_CATALOG, type CsiInstall } from '~/platforms/cloudfleet/csi-catalog.js';
import { deleteManifest } from '~/lib/k8s-apply.js';

const CERT_MANAGER_NAMESPACE = 'cert-manager';
const ACME_ACCOUNT_KEY_SECRETS = ['letsencrypt-prod-account-key', 'letsencrypt-staging-account-key'];
const LEGACY_STAGING_NAMESPACE = 'kubwave-staging';

const DEPENDENCY_RELEASES: { release: string; namespace: string }[] = [
	{ release: 'traefik', namespace: 'traefik' },
	{ release: 'cert-manager', namespace: 'cert-manager' },
	// CNPG operator: helm uninstall drops operator + RBAC + webhooks; its kept CRDs are swept separately.
	{ release: 'cnpg', namespace: 'cnpg-system' }
];

export interface ReleaseTarget {
	release: string;
	namespace: string;
}

export interface CsiTeardownTarget {
	label: string;
	provisioner: string;
	install: CsiInstall;
	// Only set for StorageClasses kubwave created (via createStorageClass); undefined means skip SC deletion.
	storageClass?: string;
}

export interface UninstallPlan {
	appRelease: ReleaseTarget;
	// Detected staging release; null when --keep-staging or no staging namespace. Acted on only when non-null.
	stagingRelease: ReleaseTarget | null;
	// Namespace probed for staging; always set so callers can report what was checked.
	stagingNamespace: string;
	// True if the staging namespace exists (even release-less) — the orphan namespace still gets deleted.
	stagingNamespaceExists: boolean;
	deletePvcs: boolean;
	acmeAccountSecrets: Array<{ name: string; namespace: string }>;
	dependencyReleases: ReleaseTarget[];
	namespacesToDelete: string[];
	// Worker per-env namespaces (absent from the chart), found by the managed-by label; kept separate so chart/dependency teardown stays deterministic.
	environmentNamespaces: string[];
	// Orphaned cluster-scoped RBAC with the kubwave prefix — label-less leftovers helm uninstall can't reclaim.
	clusterRoles: string[];
	clusterRoleBindings: string[];
	// CNPG CRDs: `helm uninstall cnpg` keeps them (resource-policy: keep), so delete them explicitly.
	customResourceDefinitions: string[];
	// CSI drivers installed by kubwave that need symmetric teardown (LAST step, after disk reclamation).
	csiTeardowns: CsiTeardownTarget[];
}

export interface BuildPlanOpts {
	kc: KubeConfig;
	keepStaging?: boolean;
	stagingNamespace?: string;
}

export interface UninstallOpts {
	yes: boolean;
	inCluster: boolean;
	keepStaging: boolean;
	stagingNamespace: string;
}

// How long to wait for all PVs backed by a CSI driver to disappear before giving up and leaving the
// driver in place (skip-to-avoid-orphaning-disks). Generous by default because disk deletion can lag
// on slow/overloaded clusters — too short and uninstall skips the teardown while the disk is still
// being reclaimed, leaving the driver behind. Override (seconds) with KUBWAVE_PV_DRAIN_TIMEOUT.
export const CSI_PV_DRAIN_TIMEOUT_MS = resolvePvDrainTimeoutMs();
export const CSI_PV_POLL_INTERVAL_MS = 5_000;

function resolvePvDrainTimeoutMs(): number {
	const seconds = Number(process.env.KUBWAVE_PV_DRAIN_TIMEOUT?.trim());
	if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
	return 300_000; // 5 minutes
}

export function registerUninstallCommand(parent: Command): void {
	parent
		.command('uninstall')
		.description('Removes kubwave from the Kubernetes cluster (deletes all data!)')
		.option('--yes', 'Skip confirmation prompt', false)
		.option('--in-cluster', 'Use in-cluster kubeconfig', false)
		.option('--keep-staging', 'Do not touch the staging namespace / release (default: auto-detect and include)', false)
		.option('--staging-namespace <ns>', 'Namespace to probe for a legacy staging release', LEGACY_STAGING_NAMESPACE)
		.action(async (opts: UninstallOpts) => {
			try {
				await runUninstall(opts);
			} catch (err) {
				printAndExit(err);
			}
		});
}

export async function runUninstall(opts: UninstallOpts): Promise<void> {
	p.intro('kubwave uninstall');

	const spinner = p.spinner();
	spinner.start('Loading kubeconfig...');
	const kc = loadKubeConfig(opts.inCluster);
	spinner.stop('Kubeconfig loaded');

	const { server, context } = getClusterInfo(kc);

	p.log.info(`Cluster-Context: ${context}`);
	p.log.info(`Server:          ${server}`);
	p.log.info(`Namespace:       ${APP_NAMESPACE}`);
	p.log.warn(
		'This will delete the helm release, all secrets, all PVCs, the namespace, the Traefik + cert-manager + CloudNativePG dependencies (incl. their CRDs), every per-environment namespace (with all tenant services and their volumes), orphaned cluster-scoped kubwave RBAC, and any detected CSI driver (after PV drain). Data cannot be recovered.'
	);

	const plan = await buildUninstallPlan({
		kc,
		keepStaging: opts.keepStaging,
		stagingNamespace: opts.stagingNamespace
	});

	if (plan.stagingRelease) {
		p.log.info(`Staging release detected: ${plan.stagingRelease.release} in ${plan.stagingRelease.namespace} — will also be removed.`);
	} else if (plan.stagingNamespaceExists) {
		p.log.info(`Staging namespace "${plan.stagingNamespace}" exists with no helm release — will be deleted.`);
	} else if (!opts.keepStaging) {
		p.log.info(`No staging namespace "${plan.stagingNamespace}" on the cluster — nothing to clean up there.`);
	}
	if (plan.environmentNamespaces.length > 0) {
		p.log.info(
			`${plan.environmentNamespaces.length} worker-provisioned environment namespace(s) found — will be deleted with all tenant services inside: ${plan.environmentNamespaces.join(', ')}`
		);
	}

	const orphanRbacCount = plan.clusterRoles.length + plan.clusterRoleBindings.length;

	if (orphanRbacCount > 0) {
		p.log.info(`${orphanRbacCount} cluster-scoped kubwave RBAC object(s) found — will be deleted.`);
	}

	if (plan.customResourceDefinitions.length > 0) {
		p.log.info(`${plan.customResourceDefinitions.length} CloudNativePG CRD(s) found — will be deleted after the operator is removed.`);
	}

	if (plan.csiTeardowns.length > 0) {
		for (const t of plan.csiTeardowns) {
			p.log.info(`CSI driver "${t.label}" detected — will be removed after PV drain.`);
		}
	}

	await confirmUninstallPlan(plan, opts.yes);

	const api = kc.makeApiClient(CoreV1Api);
	const rbacApi = kc.makeApiClient(RbacAuthorizationV1Api);
	const crdApi = kc.makeApiClient(ApiextensionsV1Api);

	await uninstallReleases(plan);
	await deletePersistentVolumeClaims(api, plan);
	await deleteAcmeAccountKeys(api, plan);
	await uninstallDependencyReleases(plan);
	await deleteNamespaces(api, plan);
	await deleteEnvironmentNamespaces(api, plan);
	await deleteClusterScopedRbac(rbacApi, plan);
	await deleteCustomResourceDefinitions(crdApi, plan);
	await teardownCsiDrivers(kc, plan);

	p.log.success('kubwave removed from the cluster.');
	p.outro('Uninstall complete');
}

export async function buildUninstallPlan(opts: BuildPlanOpts): Promise<UninstallPlan> {
	const stagingNamespace = opts.stagingNamespace ?? LEGACY_STAGING_NAMESPACE;
	let stagingRelease: ReleaseTarget | null = null;
	let stagingNamespaceExists = false;

	if (!opts.keepStaging) {
		const detection = await detectStaging(opts.kc, stagingNamespace);

		stagingRelease = detection.release;
		stagingNamespaceExists = detection.namespaceExists;
	}

	const baseNamespaces = [APP_NAMESPACE, ...new Set(DEPENDENCY_RELEASES.map(d => d.namespace))];
	const namespacesToDelete =
		stagingNamespaceExists && !baseNamespaces.includes(stagingNamespace) ? [...baseNamespaces, stagingNamespace] : baseNamespaces;

	const environmentNamespaces = await detectEnvironmentNamespaces(opts.kc);
	const { clusterRoles, clusterRoleBindings } = await detectOrphanClusterRbac(opts.kc);
	const customResourceDefinitions = await detectCnpgCrds(opts.kc);
	const csiTeardowns = await detectCsiTeardowns(opts.kc);

	return {
		appRelease: { release: HELM_RELEASE_NAME, namespace: APP_NAMESPACE },
		stagingRelease,
		stagingNamespace,
		stagingNamespaceExists,
		deletePvcs: true,
		acmeAccountSecrets: ACME_ACCOUNT_KEY_SECRETS.map(name => ({ name, namespace: CERT_MANAGER_NAMESPACE })),
		dependencyReleases: DEPENDENCY_RELEASES,
		namespacesToDelete,
		environmentNamespaces,
		clusterRoles,
		clusterRoleBindings,
		customResourceDefinitions,
		csiTeardowns
	};
}

// CNPG CRDs helm keeps (resource-policy:keep); deleting them cascades any remaining Cluster CRs.
async function detectCnpgCrds(kc: KubeConfig): Promise<string[]> {
	const api = kc.makeApiClient(ApiextensionsV1Api);
	const result = await api.listCustomResourceDefinition();

	return result.items
		.map(crd => crd.metadata?.name)
		.filter((name): name is string => typeof name === 'string' && name.endsWith(CNPG_CRD_GROUP_SUFFIX));
}

// Worker per-env namespaces (managed-by label); helm has no record, so without this they orphan with their tenant services, PVCs and volumes.
async function detectEnvironmentNamespaces(kc: KubeConfig): Promise<string[]> {
	const api = kc.makeApiClient(CoreV1Api);
	const result = await api.listNamespace({ labelSelector: WORKER_MANAGED_BY_SELECTOR });

	return result.items.map(ns => ns.metadata?.name).filter((name): name is string => typeof name === 'string');
}

// ClusterRoles/Bindings matched by name prefix (not label): the kubectl-apply leftovers we're after carry no helm labels.
async function detectOrphanClusterRbac(kc: KubeConfig): Promise<{ clusterRoles: string[]; clusterRoleBindings: string[] }> {
	const api = kc.makeApiClient(RbacAuthorizationV1Api);
	const [roles, bindings] = await Promise.all([api.listClusterRole(), api.listClusterRoleBinding()]);
	const matching = (items: Array<{ metadata?: { name?: string } }>): string[] =>
		items.map(item => item.metadata?.name).filter((name): name is string => typeof name === 'string' && name.startsWith(APP_CLUSTER_RESOURCE_PREFIX));

	return { clusterRoles: matching(roles.items), clusterRoleBindings: matching(bindings.items) };
}

// CSI drivers installed by kubwave: helm releases checked by listing releases in their namespace; manifest drivers by namespace existence.
async function detectCsiTeardowns(kc: KubeConfig): Promise<CsiTeardownTarget[]> {
	const api = kc.makeApiClient(CoreV1Api);
	const targets: CsiTeardownTarget[] = [];
	// Cache per namespace so kube-system (hetzner + aws) is only listed once.
	const releaseCache = new Map<string, string[]>();

	for (const csi of Object.values(CSI_CATALOG)) {
		let present = false;

		if (csi.install.kind === 'helm') {
			const ns = csi.install.namespace;
			if (!releaseCache.has(ns)) releaseCache.set(ns, await listReleaseNames(ns));
			present = releaseCache.get(ns)!.includes(csi.install.release);
		} else {
			try {
				await api.readNamespace({ name: csi.install.namespace });
				present = true;
			} catch (err) {
				if (!isNotFoundError(err)) throw err;
			}
		}

		if (present) {
			targets.push({
				label: csi.label,
				provisioner: csi.provisioner,
				install: csi.install,
				storageClass: csi.createStorageClass?.name
			});
		}
	}

	return targets;
}

interface StagingDetection {
	release: ReleaseTarget | null;
	namespaceExists: boolean;
}

async function detectStaging(kc: KubeConfig, namespace: string): Promise<StagingDetection> {
	const api = kc.makeApiClient(CoreV1Api);
	try {
		await api.readNamespace({ name: namespace });
	} catch (err) {
		if (isNotFoundError(err)) return { release: null, namespaceExists: false };
		throw err;
	}

	const releaseNames = await listReleaseNames(namespace);
	const release = releaseNames.length > 0 ? { release: releaseNames[0]!, namespace } : null;

	return { release, namespaceExists: true };
}

async function confirmUninstallPlan(plan: UninstallPlan, skipConfirm: boolean): Promise<void> {
	const opParts = [
		`uninstall ${plan.appRelease.release}`,
		plan.stagingRelease ? `uninstall staging ${plan.stagingRelease.release}` : null,
		'delete PVCs',
		`delete ${plan.namespacesToDelete.length} namespaces`,
		plan.environmentNamespaces.length > 0 ? `delete ${plan.environmentNamespaces.length} environment namespaces` : null,
		plan.clusterRoles.length + plan.clusterRoleBindings.length > 0
			? `delete ${plan.clusterRoles.length + plan.clusterRoleBindings.length} cluster RBAC objects`
			: null,
		plan.customResourceDefinitions.length > 0 ? `delete ${plan.customResourceDefinitions.length} CRDs` : null,
		`uninstall ${plan.dependencyReleases.length} dependencies`,
		plan.csiTeardowns.length > 0 ? `remove ${plan.csiTeardowns.length} CSI driver(s)` : null
	].filter((part): part is string => part !== null);

	p.log.info(`Planned operations: ${opParts.join(', ')}.`);

	if (skipConfirm) {
		p.log.step('Confirmation skipped (--yes)');
		return;
	}

	const message = plan.stagingRelease
		? `Really uninstall kubwave (including the detected staging release "${plan.stagingRelease.release}") from this cluster?`
		: 'Really uninstall kubwave from this cluster?';

	const confirmed = await p.confirm({ message, initialValue: false });

	if (p.isCancel(confirmed) || !confirmed) {
		throw new UserCancelledError('Uninstall aborted.');
	}
}

async function uninstallReleases(plan: UninstallPlan): Promise<void> {
	await uninstallAppRelease(plan);

	if (plan.stagingRelease) await uninstallStagingRelease(plan.stagingRelease);
}

async function uninstallAppRelease(plan: UninstallPlan): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`helm uninstall ${plan.appRelease.release}...`);
	try {
		const { removed } = await helmUninstall(plan.appRelease.release, plan.appRelease.namespace);
		spinner.stop(removed ? 'Helm release removed' : 'Helm release not found — skipped');
	} catch (err) {
		spinner.stop('helm uninstall failed');
		throw err;
	}
}

async function uninstallStagingRelease(target: ReleaseTarget): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`helm uninstall ${target.release} (staging)...`);
	try {
		const { removed } = await helmUninstall(target.release, target.namespace);
		spinner.stop(removed ? 'Staging helm release removed' : 'Staging helm release not found — skipped');
	} catch (err) {
		spinner.stop('helm uninstall (staging) failed');
		throw err;
	}
}

async function deletePersistentVolumeClaims(api: CoreV1Api, plan: UninstallPlan): Promise<void> {
	if (!plan.deletePvcs) return;

	const namespaces = [plan.appRelease.namespace];

	if (plan.stagingRelease && !namespaces.includes(plan.stagingRelease.namespace)) {
		namespaces.push(plan.stagingRelease.namespace);
	}

	for (const ns of namespaces) {
		await deletePvcsInNamespace(api, ns);
	}
}

async function deletePvcsInNamespace(api: CoreV1Api, namespace: string): Promise<void> {
	const spinner = p.spinner();
	spinner.start(`Deleting PersistentVolumeClaims in ${namespace}...`);
	try {
		const pvcs = await api.listNamespacedPersistentVolumeClaim({ namespace });
		if (pvcs.items.length === 0) {
			spinner.stop(`No PVCs in ${namespace}`);
			return;
		}

		for (const pvc of pvcs.items) {
			const name = pvc.metadata?.name;
			if (!name) continue;

			try {
				await api.deleteNamespacedPersistentVolumeClaim({ name, namespace });
				p.log.success(`PVC "${name}" deleted`);
			} catch (err) {
				if (isNotFoundError(err)) {
					p.log.step(`PVC "${name}" not found — skipped`);
				} else {
					throw err;
				}
			}
		}
		spinner.stop(`PVCs in ${namespace} deleted`);
	} catch (err) {
		if (isNotFoundError(err)) {
			spinner.stop(`Namespace "${namespace}" already gone — skipping PVCs`);
		} else {
			spinner.stop('PVC deletion failed');
			throw err;
		}
	}
}

async function deleteAcmeAccountKeys(api: CoreV1Api, plan: UninstallPlan): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Deleting cert-manager ACME account keys...');
	let removedAcme = 0;

	for (const { name, namespace } of plan.acmeAccountSecrets) {
		try {
			await api.deleteNamespacedSecret({ name, namespace });
			removedAcme++;
			p.log.success(`Secret "${namespace}/${name}" deleted`);
		} catch (err) {
			if (isNotFoundError(err)) continue;
			spinner.stop('ACME key deletion failed');
			throw err;
		}
	}

	spinner.stop(removedAcme === 0 ? 'No ACME account keys found' : 'ACME account keys deleted');
}

async function uninstallDependencyReleases(plan: UninstallPlan): Promise<void> {
	const spinner = p.spinner();

	for (const { release, namespace } of plan.dependencyReleases) {
		spinner.start(`helm uninstall ${release}...`);
		try {
			const { removed } = await helmUninstall(release, namespace);
			spinner.stop(removed ? `${release} removed` : `${release} not found — skipped`);
		} catch (err) {
			spinner.stop(`helm uninstall ${release} failed`);
			throw err;
		}
	}
}

async function deleteNamespaces(api: CoreV1Api, plan: UninstallPlan): Promise<void> {
	const spinner = p.spinner();

	for (const ns of plan.namespacesToDelete) {
		spinner.start(`Deleting namespace "${ns}" (may take a moment for finalizers)...`);
		try {
			await api.deleteNamespace({ name: ns });
			spinner.stop(`Namespace "${ns}" deletion requested`);
		} catch (err) {
			if (isNotFoundError(err)) {
				spinner.stop(`Namespace "${ns}" not found — skipped`);
			} else {
				spinner.stop(`Namespace "${ns}" deletion failed`);
				throw err;
			}
		}
	}
}

// Drop the worker's per-env namespaces; each cascades its tenant workloads/PVCs, and Delete-reclaim PVCs take their volumes too.
async function deleteEnvironmentNamespaces(api: CoreV1Api, plan: UninstallPlan): Promise<void> {
	if (plan.environmentNamespaces.length === 0) return;

	const spinner = p.spinner();

	for (const ns of plan.environmentNamespaces) {
		spinner.start(`Deleting environment namespace "${ns}" (cascades tenant services + volumes)...`);
		try {
			await api.deleteNamespace({ name: ns });
			spinner.stop(`Environment namespace "${ns}" deletion requested`);
		} catch (err) {
			if (isNotFoundError(err)) {
				spinner.stop(`Environment namespace "${ns}" not found — skipped`);
			} else {
				spinner.stop(`Environment namespace "${ns}" deletion failed`);
				throw err;
			}
		}
	}
}

// Sweep orphaned cluster RBAC; bindings before roles so no binding points at a deleted role.
async function deleteClusterScopedRbac(api: RbacAuthorizationV1Api, plan: UninstallPlan): Promise<void> {
	if (plan.clusterRoles.length === 0 && plan.clusterRoleBindings.length === 0) return;

	const spinner = p.spinner();
	spinner.start('Deleting cluster-scoped kubwave RBAC...');

	for (const name of plan.clusterRoleBindings) {
		try {
			await api.deleteClusterRoleBinding({ name });
			p.log.success(`ClusterRoleBinding "${name}" deleted`);
		} catch (err) {
			if (isNotFoundError(err)) p.log.step(`ClusterRoleBinding "${name}" not found — skipped`);
			else {
				spinner.stop('Cluster RBAC deletion failed');
				throw err;
			}
		}
	}

	for (const name of plan.clusterRoles) {
		try {
			await api.deleteClusterRole({ name });
			p.log.success(`ClusterRole "${name}" deleted`);
		} catch (err) {
			if (isNotFoundError(err)) p.log.step(`ClusterRole "${name}" not found — skipped`);
			else {
				spinner.stop('Cluster RBAC deletion failed');
				throw err;
			}
		}
	}

	spinner.stop('Cluster-scoped kubwave RBAC removed');
}

// Delete the CNPG CRDs helm keeps; runs after the operator is gone so no controller fights it.
async function deleteCustomResourceDefinitions(api: ApiextensionsV1Api, plan: UninstallPlan): Promise<void> {
	if (plan.customResourceDefinitions.length === 0) return;

	const spinner = p.spinner();
	spinner.start('Deleting CloudNativePG CRDs...');

	for (const name of plan.customResourceDefinitions) {
		try {
			await api.deleteCustomResourceDefinition({ name });
			p.log.success(`CRD "${name}" deleted`);
		} catch (err) {
			if (isNotFoundError(err)) p.log.step(`CRD "${name}" not found — skipped`);
			else {
				spinner.stop('CRD deletion failed');
				throw err;
			}
		}
	}

	spinner.stop('CloudNativePG CRDs removed');
}

// Last step: tear down CSI drivers after all workloads and namespaces are gone.
// Waits for PVs backed by each driver to drain; skips if they persist (safety — never orphan cloud disks).
export async function teardownCsiDrivers(kc: KubeConfig, plan: UninstallPlan, opts?: { timeoutMs?: number; pollMs?: number }): Promise<void> {
	if (plan.csiTeardowns.length === 0) return;

	const timeoutMs = opts?.timeoutMs ?? CSI_PV_DRAIN_TIMEOUT_MS;
	const pollMs = opts?.pollMs ?? CSI_PV_POLL_INTERVAL_MS;

	const coreApi = kc.makeApiClient(CoreV1Api);
	const storageApi = kc.makeApiClient(StorageV1Api);

	for (const target of plan.csiTeardowns) {
		const spinner = p.spinner();
		spinner.start(`Tearing down CSI driver: ${target.label}...`);

		// Wait for all PVs backed by this driver to disappear before removing it.
		let pvCount = await countCsiPvs(coreApi, target.provisioner);
		if (pvCount > 0) {
			const deadline = Date.now() + timeoutMs;
			while (pvCount > 0 && Date.now() < deadline) {
				await new Promise(r => setTimeout(r, pollMs));
				pvCount = await countCsiPvs(coreApi, target.provisioner);
			}
		}

		if (pvCount > 0) {
			// Safety: leave the driver in place rather than risk orphaning cloud disks.
			spinner.stop(`CSI driver "${target.label}" — SKIPPED (${pvCount} PV(s) still present)`);
			p.log.warn(
				`${pvCount} PersistentVolume(s) for driver "${target.provisioner}" still exist. The CSI driver is being LEFT IN PLACE to avoid orphaning cloud disks. Once the PVs are gone, re-run uninstall (or raise the drain timeout with KUBWAVE_PV_DRAIN_TIMEOUT=<seconds> on a slow cluster).`
			);
			continue;
		}

		const csiInstall = target.install;
		if (csiInstall.kind === 'helm') {
			await helmUninstall(csiInstall.release, csiInstall.namespace);
		} else {
			await deleteManifest(kc, csiInstall.manifest);
		}

		if (target.storageClass) {
			try {
				await storageApi.deleteStorageClass({ name: target.storageClass });
			} catch (err) {
				if (!isNotFoundError(err)) throw err;
			}
		}

		spinner.stop(`CSI driver "${target.label}" removed`);
	}
}

export async function countCsiPvs(api: CoreV1Api, provisioner: string): Promise<number> {
	let count = 0;
	let cont: string | undefined;
	do {
		const list = await api.listPersistentVolume({ limit: 500, _continue: cont });
		for (const pv of list.items) {
			if (pv.spec?.csi?.driver === provisioner) count++;
		}
		cont = list.metadata?._continue || undefined;
	} while (cont);
	return count;
}
