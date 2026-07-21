import type { Command } from 'commander';
import * as p from '@clack/prompts';
import {
	ApiextensionsV1Api,
	CoreV1Api,
	KubernetesObjectApi,
	RbacAuthorizationV1Api,
	StorageV1Api,
	type KubeConfig,
	type KubernetesObject,
	type V1PersistentVolume
} from '@kubernetes/client-node';
import {
	APP_NAMESPACE,
	APP_CLUSTER_RESOURCE_PREFIX,
	KEPT_DEPENDENCY_CRD_GROUPS,
	HELM_RELEASE_NAME,
	WORKER_MANAGED_BY_SELECTOR,
	KUBWAVE_MANAGED_BY_LABEL,
	KUBWAVE_CLI_MANAGED_BY_VALUE,
	KUBWAVE_PART_OF_LABEL,
	KUBWAVE_PART_OF_VALUE
} from '~/lib/constants.js';
import { getClusterInfo, loadKubeConfig } from '~/lib/k8s.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';
import { helmUninstall, listReleaseNames } from '~/lib/helm.js';
import { UserCancelledError, printAndExit } from '~/lib/errors.js';
import { CSI_CATALOG, type CsiDefinition, type CsiInstall } from '~/platforms/cloudfleet/csi-catalog.js';
import { detectUpcloudAutoscalerInstalled, teardownUpcloudAutoscaler } from '~/platforms/upcloud/autoscaling.js';
import { deleteManifest, listAllCustomObjectsWith, mergePatchWith } from '~/lib/k8s-apply.js';

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

// A dependency CRD helm keeps (resource-policy:keep), carrying the served apiVersion/kind needed to reach its CRs —
// resolved once at plan time so teardown never has to re-list every CRD on the cluster.
export interface DependencyCrd {
	name: string;
	apiVersion: string;
	kind: string;
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
	customResourceDefinitions: DependencyCrd[];
	// CSI drivers installed by kubwave that need symmetric teardown (LAST step, after disk reclamation).
	csiTeardowns: CsiTeardownTarget[];
	upcloudAutoscalerInstalled: boolean;
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

function targetNamespaceSet(plan: UninstallPlan): Set<string> {
	const namespaces = new Set<string>([...plan.namespacesToDelete, ...plan.environmentNamespaces, plan.appRelease.namespace]);
	if (plan.stagingRelease) namespaces.add(plan.stagingRelease.namespace);
	return namespaces;
}

async function patchPVReclaimPolicyToDelete(patchApi: ReturnType<typeof KubernetesObjectApi.makeApiClient>, pvName: string): Promise<void> {
	const patch = { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: pvName }, spec: { persistentVolumeReclaimPolicy: 'Delete' } };
	await mergePatchWith(patchApi, patch as unknown as KubernetesObject);
}

async function forEachPersistentVolume(api: CoreV1Api, cb: (pv: V1PersistentVolume) => void | Promise<void>): Promise<void> {
	let cont: string | undefined;
	do {
		const list = await api.listPersistentVolume({ limit: 500, _continue: cont });
		for (const pv of list.items) await cb(pv);
		cont = list.metadata?._continue || undefined;
	} while (cont);
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
		p.log.info(`${plan.customResourceDefinitions.length} dependency CRD(s) found — will be deleted after the operators are removed.`);
	}

	if (plan.csiTeardowns.length > 0) {
		for (const t of plan.csiTeardowns) {
			p.log.info(`CSI driver "${t.label}" detected — will be removed after PV drain.`);
		}
	}

	if (plan.upcloudAutoscalerInstalled) {
		p.log.info('UpCloud Cluster Autoscaler (kubwave-installed) detected — will be removed after CSI teardown.');
	}

	await confirmUninstallPlan(plan, opts.yes);

	const api = kc.makeApiClient(CoreV1Api);
	const rbacApi = kc.makeApiClient(RbacAuthorizationV1Api);
	const crdApi = kc.makeApiClient(ApiextensionsV1Api);
	const patchApi = KubernetesObjectApi.makeApiClient(kc);

	await uninstallReleases(plan);
	await deletePersistentVolumeClaims(api, patchApi, plan);
	await reclaimRetainedPvs(kc, plan);
	await deleteAcmeAccountKeys(api, plan);
	await uninstallDependencyReleases(plan);
	await drainDependencyCustomResources(kc, plan);
	await deleteNamespaces(api, plan);
	await deleteEnvironmentNamespaces(api, plan);
	await deleteClaimedPersistentVolumes(kc, plan);
	await deleteClusterScopedRbac(rbacApi, plan);
	await deleteCustomResourceDefinitions(crdApi, plan);
	await teardownCsiDrivers(kc, plan);
	if (plan.upcloudAutoscalerInstalled) {
		await teardownUpcloudAutoscaler(kc, true);
	}

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

	// Independent cluster reads — run concurrently so plan-building doesn't serialize round-trips.
	const [environmentNamespaces, { clusterRoles, clusterRoleBindings }, customResourceDefinitions, csiTeardowns, upcloudAutoscalerInstalled] =
		await Promise.all([
			detectEnvironmentNamespaces(opts.kc),
			detectOrphanClusterRbac(opts.kc),
			detectKeptDependencyCrds(opts.kc),
			detectCsiTeardowns(opts.kc),
			detectUpcloudAutoscalerInstalled(opts.kc)
		]);

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
		csiTeardowns,
		upcloudAutoscalerInstalled
	};
}

// Dependency CRDs helm keeps (resource-policy:keep) — deleting them cascades any remaining CRs in those groups.
// Guarded by part-of=kubwave (stamped on the CRDs we installed) so a user's pre-existing cert-manager is left intact.
async function detectKeptDependencyCrds(kc: KubeConfig): Promise<DependencyCrd[]> {
	const api = kc.makeApiClient(ApiextensionsV1Api);
	const result = await api.listCustomResourceDefinition();

	return result.items.flatMap((crd): DependencyCrd[] => {
		const group = crd.spec?.group;
		if (
			crd.metadata?.labels?.[KUBWAVE_PART_OF_LABEL] !== KUBWAVE_PART_OF_VALUE ||
			typeof group !== 'string' ||
			!KEPT_DEPENDENCY_CRD_GROUPS.includes(group)
		) {
			return [];
		}

		const name = crd.metadata?.name;
		const kind = crd.spec?.names?.kind;
		const version = (crd.spec?.versions ?? []).find(v => v.served)?.name ?? crd.spec?.versions?.[0]?.name;
		if (!name || !kind || !version) return [];
		return [{ name, apiVersion: `${group}/${version}`, kind }];
	});
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

// Detect kubwave's CSI drivers by the ownership labels on their CSIDriver object (named after the provisioner,
// created by both helm and manifest installs, never a user-created prerequisite) — uniform and rename-robust.
// A legacy fallback (helm release name / manifest namespace label) catches pre-label installs, deduped by provisioner.
async function detectCsiTeardowns(kc: KubeConfig): Promise<CsiTeardownTarget[]> {
	const coreApi = kc.makeApiClient(CoreV1Api);
	const storageApi = kc.makeApiClient(StorageV1Api);

	const byProvisioner = new Map(Object.values(CSI_CATALOG).map(csi => [csi.provisioner, csi]));
	const found = new Map<string, CsiTeardownTarget>();
	const add = (csi: CsiDefinition): void => {
		if (found.has(csi.provisioner)) return;
		found.set(csi.provisioner, {
			label: csi.label,
			provisioner: csi.provisioner,
			install: csi.install,
			storageClass: csi.createStorageClass?.name
		});
	};

	// part-of + a CSIDriver name that matches a catalog provisioner is proof we installed it: a user's own
	// driver of the same name carries no part-of=kubwave. (component is chart-owned on helm drivers, so not checked.)
	try {
		const drivers = await storageApi.listCSIDriver();
		for (const driver of drivers.items) {
			if (driver.metadata?.labels?.[KUBWAVE_PART_OF_LABEL] !== KUBWAVE_PART_OF_VALUE) continue;
			const csi = byProvisioner.get(driver.metadata?.name ?? '');
			if (csi) add(csi);
		}
	} catch (err) {
		// Label-based detection unavailable (missing RBAC / transient API error) — warn, then fall through to legacy detection.
		const message = err instanceof Error ? err.message : String(err);
		p.log.warn(`Could not list CSIDrivers (${message}); falling back to release-name/namespace detection, which may miss a renamed CSI release.`);
	}

	// Cache helm releases per namespace so kube-system (hetzner + aws) is listed once.
	const releaseCache = new Map<string, string[]>();
	for (const csi of Object.values(CSI_CATALOG)) {
		if (found.has(csi.provisioner)) continue;
		let present = false;

		if (csi.install.kind === 'helm') {
			const ns = csi.install.namespace;
			if (!releaseCache.has(ns)) releaseCache.set(ns, await listReleaseNames(ns));
			present = releaseCache.get(ns)!.includes(csi.install.release);
		} else {
			try {
				const ns = await coreApi.readNamespace({ name: csi.install.namespace });
				present = ns.metadata?.labels?.[KUBWAVE_MANAGED_BY_LABEL] === KUBWAVE_CLI_MANAGED_BY_VALUE;
			} catch (err) {
				if (!isNotFoundError(err)) throw err;
			}
		}

		if (present) add(csi);
	}

	return [...found.values()];
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
		plan.csiTeardowns.length > 0 ? `remove ${plan.csiTeardowns.length} CSI driver(s)` : null,
		plan.upcloudAutoscalerInstalled ? 'remove UpCloud Cluster Autoscaler' : null
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

async function deletePersistentVolumeClaims(
	api: CoreV1Api,
	patchApi: ReturnType<typeof KubernetesObjectApi.makeApiClient>,
	plan: UninstallPlan
): Promise<void> {
	if (!plan.deletePvcs) return;

	const namespaces = [plan.appRelease.namespace];

	if (plan.stagingRelease && !namespaces.includes(plan.stagingRelease.namespace)) {
		namespaces.push(plan.stagingRelease.namespace);
	}

	for (const ns of namespaces) {
		await deletePvcsInNamespace(api, patchApi, ns);
	}
}

async function deletePvcsInNamespace(
	api: CoreV1Api,
	patchApi: ReturnType<typeof KubernetesObjectApi.makeApiClient>,
	namespace: string
): Promise<void> {
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

			const pvName = pvc.spec?.volumeName;
			let pv: Awaited<ReturnType<typeof api.readPersistentVolume>> | undefined;
			if (pvName) {
				try {
					pv = await api.readPersistentVolume({ name: pvName });
				} catch (err) {
					if (!isNotFoundError(err)) {
						// Non-fatal: a missing PV just means nothing to patch; the PVC delete still proceeds.
						p.log.warn(`Could not read bound PV "${pvName}" for PVC "${name}": ${err instanceof Error ? err.message : String(err)}`);
					}
				}
			}

			// A Retain PV keeps the cloud disk after the PVC is gone (UpCloud UKS ships Retain). Patch to Delete
			// while still Bound so the CSI controller reclaims the disk when the PVC disappears. Safe on Delete
			// PVs (no-op) and on Retain PVs whose CSI driver is still running (always true here — teardown is last).
			if (pv?.spec?.persistentVolumeReclaimPolicy === 'Retain') {
				try {
					await patchPVReclaimPolicyToDelete(patchApi, pvName!);
					p.log.info(`PV "${pvName}" reclaimPolicy Retain → Delete (disk will be reclaimed)`);
				} catch (err) {
					if (!isNotFoundError(err)) {
						p.log.warn(
							`Could not patch PV "${pvName}" reclaimPolicy to Delete: ${err instanceof Error ? err.message : String(err)} — cloud disk may persist.`
						);
					}
				}
			}

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

// Sweep all PVs whose claimRef points to a namespace we're deleting and patch Retain → Delete so the CSI
// controller reclaims the cloud disk. Catches already-Released orphan PVs from prior runs (e.g. UpCloud UKS
// ships its StorageClass with reclaimPolicy: Retain, so each leftover PV keeps its disk forever). Must run
// before CSI teardown so the driver is still alive to process DeleteVolume.
export async function reclaimRetainedPvs(kc: KubeConfig, plan: UninstallPlan): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);
	const patchApi = KubernetesObjectApi.makeApiClient(kc);
	const targetNamespaces = targetNamespaceSet(plan);

	const spinner = p.spinner();
	spinner.start('Reclaiming retained PersistentVolumes for deleted namespaces...');

	let patched = 0;
	let skipped = 0;
	await forEachPersistentVolume(api, async pv => {
		const name = pv.metadata?.name;
		const claimNs = pv.spec?.claimRef?.namespace;
		if (!name || !claimNs || !targetNamespaces.has(claimNs)) return;
		if (pv.spec?.persistentVolumeReclaimPolicy !== 'Retain') {
			skipped++;
			return;
		}

		try {
			await patchPVReclaimPolicyToDelete(patchApi, name);
			patched++;
			p.log.info(`PV "${name}" reclaimPolicy Retain → Delete (claim in ${claimNs})`);
		} catch (err) {
			if (!isNotFoundError(err)) {
				p.log.warn(`Could not patch PV "${name}" reclaimPolicy to Delete: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	});

	spinner.stop(patched === 0 ? 'No retained PVs needed reclaiming' : `Patched ${patched} retained PV(s) to Delete (${skipped} already Delete)`);
}

// Delete PVs whose claim lived in a removed namespace: strip pv-protection, force reclaimPolicy Delete, and delete while the CSI driver still lives so DeleteVolume fires. Polls because namespace deletion is async, so a PV may still be Bound on the first pass and only become Released once its PVC is gone.
export async function deleteClaimedPersistentVolumes(
	kc: KubeConfig,
	plan: UninstallPlan,
	opts?: { timeoutMs?: number; pollMs?: number }
): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);
	const patchApi = KubernetesObjectApi.makeApiClient(kc);
	const targetNamespaces = targetNamespaceSet(plan);
	const timeoutMs = opts?.timeoutMs ?? CSI_PV_DRAIN_TIMEOUT_MS;
	const pollMs = opts?.pollMs ?? CSI_PV_POLL_INTERVAL_MS;

	const spinner = p.spinner();
	spinner.start('Deleting claimed PersistentVolumes for removed namespaces...');

	const listTargetPvs = async (): Promise<V1PersistentVolume[]> => {
		const found: V1PersistentVolume[] = [];
		await forEachPersistentVolume(api, pv => {
			const claimNs = pv.spec?.claimRef?.namespace;
			if (pv.metadata?.name && claimNs && targetNamespaces.has(claimNs)) found.push(pv);
		});
		return found;
	};

	let deleted = 0;
	let failed = 0;
	const attempted = new Set<string>();

	let target = await listTargetPvs();
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const waiting = target.filter(pv => pv.status?.phase !== 'Released');
		const ready = target.filter(pv => pv.status?.phase === 'Released' && !attempted.has(pv.metadata!.name!));

		for (const pv of ready) {
			attempted.add(pv.metadata!.name!);
			const outcome = await deleteReleasedPersistentVolume(api, patchApi, pv);
			if (outcome === 'deleted') deleted++;
			else if (outcome === 'failed') failed++;
		}

		if (waiting.length === 0 || Date.now() >= deadline) break;
		spinner.message(`Waiting for ${waiting.length} PersistentVolume(s) to be released...`);
		await new Promise(r => setTimeout(r, pollMs));
		target = await listTargetPvs();
	}

	const notYetReleased = target.filter(pv => pv.status?.phase !== 'Released').length;
	const base = deleted === 0 && notYetReleased === 0 ? 'No claimed PersistentVolumes needed deleting' : `Deleted ${deleted} claimed PV(s)`;
	const notes: string[] = [];
	if (notYetReleased > 0) notes.push(`${notYetReleased} not yet released (left for CSI teardown drain wait)`);
	if (failed > 0) notes.push(`${failed} could not be deleted (see warnings above)`);
	spinner.stop(notes.length ? `${base}; ${notes.join(', ')}` : base);
}

async function deleteReleasedPersistentVolume(
	api: CoreV1Api,
	patchApi: ReturnType<typeof KubernetesObjectApi.makeApiClient>,
	pv: V1PersistentVolume
): Promise<'deleted' | 'gone' | 'failed'> {
	const name = pv.metadata?.name;
	if (!name) return 'gone';

	const finalizers = pv.metadata?.finalizers ?? [];

	// Drop only the built-in protection finalizer; leave controller-owned ones (e.g. external-attacher) so detach can still clean up the volume attachment.
	if (finalizers.includes('kubernetes.io/pv-protection')) {
		try {
			const keep = finalizers.filter(f => f !== 'kubernetes.io/pv-protection');
			await mergePatchWith(patchApi, { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name, finalizers: keep } });
			p.log.info(`PV "${name}" stripped kubernetes.io/pv-protection finalizer`);
		} catch (err) {
			if (!isNotFoundError(err)) {
				p.log.warn(`Could not strip pv-protection finalizer on PV "${name}": ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	// Idempotent safety: ensure reclaimPolicy is Delete so the disk is reclaimed, not just the PV object.
	if (pv.spec?.persistentVolumeReclaimPolicy === 'Retain') {
		try {
			await patchPVReclaimPolicyToDelete(patchApi, name);
		} catch (err) {
			if (!isNotFoundError(err)) {
				p.log.warn(`Could not patch PV "${name}" reclaimPolicy to Delete: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	try {
		await api.deletePersistentVolume({ name });
		p.log.success(`PV "${name}" deleted (disk reclaim handed to CSI)`);
		return 'deleted';
	} catch (err) {
		if (isNotFoundError(err)) return 'gone';
		p.log.warn(`Could not delete PV "${name}": ${err instanceof Error ? err.message : String(err)}`);
		return 'failed';
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

// The dependency operators finalize their own CRs (cert-manager Certificates/Orders/Challenges, CNPG Clusters).
// We've just removed those operators, so any leftover CR would hang in Terminating forever — wedging both its
// namespace's deletion AND its CRD's. A stuck CRD then makes the NEXT install's `helm --wait` on the recreating
// CRD time out (it reads the still-Terminating CRD as NotFound). Strip finalizers now (operators gone → none re-add).
export async function drainDependencyCustomResources(kc: KubeConfig, plan: UninstallPlan): Promise<void> {
	if (plan.customResourceDefinitions.length === 0) return;

	// One client across every kind and patch so API discovery is done once, not per-call.
	const api = KubernetesObjectApi.makeApiClient(kc);
	const spinner = p.spinner();
	spinner.start('Clearing finalizers on leftover dependency resources...');

	let cleared = 0;
	let failed = 0;

	for (const { apiVersion, kind } of plan.customResourceDefinitions) {
		let items;
		try {
			items = await listAllCustomObjectsWith(api, apiVersion, kind);
		} catch (err) {
			// A gone CRD (404) means nothing to drain; anything else leaves CRs potentially wedged — count it.
			if (!isNotFoundError(err)) {
				failed++;
				p.log.warn(`Could not list ${kind} (${apiVersion}) to clear finalizers: ${err instanceof Error ? err.message : String(err)}`);
			}
			continue;
		}

		for (const item of items) {
			const crName = item.metadata?.name;
			if (!crName || !item.metadata?.finalizers?.length) continue;

			try {
				await mergePatchWith(api, { apiVersion, kind, metadata: { name: crName, namespace: item.metadata.namespace, finalizers: [] } });
				cleared++;
			} catch (err) {
				if (!isNotFoundError(err)) {
					failed++;
					p.log.warn(`Could not clear finalizers on ${kind}/${crName}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
	}

	// Never report a clean drain when a strip failed — a still-wedged CR is the exact failure this step prevents.
	const base =
		cleared === 0 && failed === 0
			? 'No leftover dependency resources needed finalizer cleanup'
			: `Cleared finalizers on ${cleared} leftover resource(s)`;
	spinner.stop(failed > 0 ? `${base}; ${failed} could not be cleared (see warnings above)` : base);
}

// Delete the dependency CRDs helm keeps; runs after the operators are gone so no controller fights it.
async function deleteCustomResourceDefinitions(api: ApiextensionsV1Api, plan: UninstallPlan): Promise<void> {
	if (plan.customResourceDefinitions.length === 0) return;

	const spinner = p.spinner();
	spinner.start('Deleting dependency CRDs...');

	for (const { name } of plan.customResourceDefinitions) {
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

	spinner.stop('Dependency CRDs removed');
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

		// Per-target isolation: a failure on one driver (transient API error, expired PV-list continue token,
		// a stuck delete) must not abort the rest of the uninstall — this is the final step.
		try {
			// Wait for all PVs backed by this driver to disappear before removing it.
			let pvCount = await countCsiPvs(coreApi, target.provisioner);
			const deadline = Date.now() + timeoutMs;
			while (pvCount > 0 && Date.now() < deadline) {
				await new Promise(r => setTimeout(r, pollMs));
				pvCount = await countCsiPvs(coreApi, target.provisioner);
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
				await deleteOwnedStorageClass(storageApi, target.storageClass);
			}

			spinner.stop(`CSI driver "${target.label}" removed`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			spinner.stop(`CSI driver "${target.label}" — teardown failed`);
			p.log.warn(`Failed to tear down CSI driver "${target.label}": ${message}. Other teardowns continue; re-run uninstall to retry.`);
		}
	}
}

// Delete a StorageClass only if kubwave created it (ownership label). Protects a user's pre-existing SC of the
// same name (e.g. a hand-made "pd-ssd"/"ebs-sc" default) from being swept — which would leave the cluster
// with no default StorageClass.
async function deleteOwnedStorageClass(api: StorageV1Api, name: string): Promise<void> {
	let sc;
	try {
		sc = await api.readStorageClass({ name });
	} catch (err) {
		if (isNotFoundError(err)) return;
		throw err;
	}

	if (sc.metadata?.labels?.[KUBWAVE_MANAGED_BY_LABEL] !== KUBWAVE_CLI_MANAGED_BY_VALUE) {
		p.log.warn(
			`StorageClass "${name}" was not created by kubwave (missing ${KUBWAVE_MANAGED_BY_LABEL}=${KUBWAVE_CLI_MANAGED_BY_VALUE}) — leaving it in place.`
		);
		return;
	}

	try {
		await api.deleteStorageClass({ name });
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
	}
}

export async function countCsiPvs(api: CoreV1Api, provisioner: string): Promise<number> {
	let count = 0;
	await forEachPersistentVolume(api, pv => {
		if (pv.spec?.csi?.driver === provisioner) count++;
	});
	return count;
}
