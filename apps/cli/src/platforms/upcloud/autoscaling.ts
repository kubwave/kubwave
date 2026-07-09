import type { KubeConfig } from '@kubernetes/client-node';
import { AppsV1Api, CoreV1Api, VersionApi } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import type { AutoscalingDecision, AutoscalingOpts, UpcloudNodeGroup } from '~/lib/platforms.js';
import { applyManifest, deleteManifest } from '~/lib/k8s-apply.js';
import { buildOwnershipLabels } from '~/lib/ownership.js';
import { FatalCliError, UserCancelledError } from '~/lib/errors.js';
import { isDeploymentReady } from '~/lib/dependencies.js';
import { isAlreadyExistsError, isNotFoundError } from '~/lib/k8s-errors.js';
import {
	KUBWAVE_CLI_MANAGED_BY_VALUE,
	KUBWAVE_COMPONENT_LABEL,
	KUBWAVE_INSTANCE_LABEL,
	KUBWAVE_MANAGED_BY_LABEL,
	KUBWAVE_PART_OF_LABEL,
	KUBWAVE_PART_OF_VALUE
} from '~/lib/constants.js';
import clusterAutoscalerRbac from './cluster-autoscaler-rbac.yaml' with { type: 'text' };
import clusterAutoscalerDeployment from './cluster-autoscaler-deployment.yaml' with { type: 'text' };

export const UPCLOUD_AUTOSCALER_NAMESPACE = 'kube-system';
export const UPCLOUD_AUTOSCALER_SECRET = 'upcloud-autoscaler';
export const UPCLOUD_AUTOSCALER_DEPLOYMENT = 'cluster-autoscaler';
export const UPCLOUD_AUTOSCALER_INSTANCE = 'upcloud-autoscaler';
export const UPCLOUD_CLUSTER_ID_PLACEHOLDER = '${UPCLOUD_CLUSTER_ID}';
export const UPCLOUD_AUTOSCALER_IMAGE_TAG_PLACEHOLDER = '${UPCLOUD_AUTOSCALER_IMAGE_TAG}';
export const UPCLOUD_AUTOSCALER_NODES_FLAGS_PLACEHOLDER = '            # ${UPCLOUD_AUTOSCALER_NODES_FLAGS}';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_GROUP_NAME_RE = /^[a-z0-9-]+$/i;

const AUTOSCALER_OWNERSHIP_LABELS = buildOwnershipLabels({
	component: 'platform',
	instance: UPCLOUD_AUTOSCALER_INSTANCE,
	cliManaged: true
});

export function hasUpcloudAutoscalerOwnership(labels: Record<string, string> | undefined): boolean {
	if (!labels) return false;
	return (
		labels[KUBWAVE_PART_OF_LABEL] === KUBWAVE_PART_OF_VALUE &&
		labels[KUBWAVE_MANAGED_BY_LABEL] === KUBWAVE_CLI_MANAGED_BY_VALUE &&
		labels[KUBWAVE_COMPONENT_LABEL] === 'platform' &&
		labels[KUBWAVE_INSTANCE_LABEL] === UPCLOUD_AUTOSCALER_INSTANCE
	);
}

export function parseUpcloudNodeGroup(spec: string): UpcloudNodeGroup {
	const parts = spec.split(':');
	if (parts.length !== 3) throw new FatalCliError(`Invalid node group spec "${spec}". Expected <min>:<max>:<name>.`);
	const minRaw = parts[0]?.trim() ?? '';
	const maxRaw = parts[1]?.trim() ?? '';
	const name = parts[2]?.trim() ?? '';
	const min = Number(minRaw);
	const max = Number(maxRaw);
	if (!minRaw || !Number.isInteger(min) || min < 0) throw new FatalCliError(`Invalid min nodes in "${spec}": must be a non-negative integer.`);
	if (!maxRaw || !Number.isInteger(max) || max < min) throw new FatalCliError(`Invalid max nodes in "${spec}": must be an integer >= min.`);
	if (!name) throw new FatalCliError(`Invalid node group name in "${spec}": name is required.`);
	if (!NODE_GROUP_NAME_RE.test(name)) {
		throw new FatalCliError(`Invalid node group name "${name}" in "${spec}": only letters, digits and hyphens are allowed.`);
	}
	return { name, min, max };
}

function formatNodesFlags(nodeGroups: UpcloudNodeGroup[] | undefined): string {
	if (!nodeGroups?.length) return '';
	return nodeGroups.map(g => `            - --nodes=${g.min}:${g.max}:${g.name}`).join('\n');
}

export function renderAutoscalerDeployment(cfg: { clusterUuid: string; imageTag: string; nodeGroups?: UpcloudNodeGroup[] }): string {
	const rendered = clusterAutoscalerDeployment
		.replaceAll(UPCLOUD_CLUSTER_ID_PLACEHOLDER, cfg.clusterUuid)
		.replaceAll(UPCLOUD_AUTOSCALER_IMAGE_TAG_PLACEHOLDER, cfg.imageTag)
		.replaceAll(UPCLOUD_AUTOSCALER_NODES_FLAGS_PLACEHOLDER, formatNodesFlags(cfg.nodeGroups));

	const leftover = /\$\{[A-Z_]+\}/.test(rendered);
	if (leftover) {
		throw new FatalCliError(
			'Unsubstituted placeholder in cluster-autoscaler deployment manifest. ' +
				'The vendored YAML may have changed upstream — check scripts/gen-upcloud-cs-manifest.sh and verify the placeholder constants in autoscaling.ts match the current template.'
		);
	}

	return rendered;
}

export function renderAutoscalerManifests(cfg: { clusterUuid: string; imageTag: string; nodeGroups?: UpcloudNodeGroup[] }): string {
	return `${clusterAutoscalerRbac}\n---\n${renderAutoscalerDeployment(cfg)}`;
}

export async function promptUpcloudAutoscaling(opts: AutoscalingOpts): Promise<AutoscalingDecision | null> {
	if (opts.upcloudAutoscaling === false) {
		p.log.info('UpCloud Cluster Autoscaler skipped (--no-upcloud-autoscaling).');
		return null;
	}

	if (opts.assumeYes && !opts.upcloudAutoscaling) {
		return null;
	}

	let enabled = opts.upcloudAutoscaling === true;
	if (!enabled && !opts.assumeYes) {
		const confirmed = await p.confirm({
			message: 'Install UpCloud Cluster Autoscaler? (scales UKS node groups based on pending pods)',
			initialValue: true
		});
		if (p.isCancel(confirmed)) throw new UserCancelledError('Cluster Autoscaler selection aborted.');
		if (!confirmed) {
			p.log.info('Cluster Autoscaler skipped.');
			return null;
		}
		enabled = true;
	}

	if (!enabled) return null;

	const clusterUuid = await resolveClusterUuid(opts);
	validateClusterUuid(clusterUuid);

	const nodeGroups = await resolveNodeGroups(opts);
	if (opts.assumeYes && nodeGroups.length === 0) {
		throw new FatalCliError('--yes with --upcloud-autoscaling requires at least one --upcloud-node-group.');
	}

	return { enabled: true, clusterUuid, ...(nodeGroups.length > 0 ? { nodeGroups } : {}) };
}

export async function ensureUpcloudAutoscaling(kc: KubeConfig, opts: AutoscalingOpts): Promise<AutoscalingDecision | void> {
	const decision = await promptUpcloudAutoscaling(opts);
	if (!decision?.enabled) return;

	const credentials = await resolveCredentials(opts);
	const { tag: imageTag, defaulted } = resolveAutoscalerImageTag(await readClusterKubernetesVersion(kc), opts.upcloudAutoscalerImageTag);
	if (defaulted) p.log.warn('Could not determine matching UpCloud autoscaler image tag; defaulting to v1.29.5.');
	await installUpcloudAutoscaler(kc, {
		clusterUuid: decision.clusterUuid,
		nodeGroups: decision.nodeGroups,
		imageTag,
		credentials
	});
	return decision;
}

export async function reconcileUpcloudAutoscaler(kc: KubeConfig, cfg: { clusterUuid: string; nodeGroups?: UpcloudNodeGroup[] }): Promise<void> {
	validateClusterUuid(cfg.clusterUuid);
	const apps = kc.makeApiClient(AppsV1Api);
	try {
		const dep = await apps.readNamespacedDeployment({ namespace: UPCLOUD_AUTOSCALER_NAMESPACE, name: UPCLOUD_AUTOSCALER_DEPLOYMENT });
		if (!hasUpcloudAutoscalerOwnership(dep.metadata?.labels)) return;
	} catch (err) {
		if (isNotFoundError(err)) return;
		throw err;
	}

	const { tag: imageTag, defaulted } = resolveAutoscalerImageTag(await readClusterKubernetesVersion(kc), undefined);
	if (defaulted) p.log.warn('Could not determine matching UpCloud autoscaler image tag during reconcile; defaulting to v1.29.5.');
	await applyUpcloudAutoscalerManifests(kc, { clusterUuid: cfg.clusterUuid, imageTag, nodeGroups: cfg.nodeGroups });
}

export async function installUpcloudAutoscaler(
	kc: KubeConfig,
	cfg: {
		clusterUuid: string;
		nodeGroups?: UpcloudNodeGroup[];
		imageTag: string;
		credentials: { token: string } | { username: string; password: string };
	}
): Promise<void> {
	validateClusterUuid(cfg.clusterUuid);

	const spinner = p.spinner();
	spinner.start('Installing UpCloud Cluster Autoscaler...');
	try {
		await ensureAutoscalerSecret(kc, cfg.credentials);
		await applyUpcloudAutoscalerManifests(kc, { clusterUuid: cfg.clusterUuid, imageTag: cfg.imageTag, nodeGroups: cfg.nodeGroups });
		await waitForAutoscalerReady(kc);
		spinner.stop('UpCloud Cluster Autoscaler installed.');
	} catch (err) {
		spinner.stop('Cluster Autoscaler installation failed.');
		throw err;
	}
}

export async function detectUpcloudAutoscalerInstalled(kc: KubeConfig): Promise<boolean> {
	const apps = kc.makeApiClient(AppsV1Api);
	if (typeof apps.readNamespacedDeployment !== 'function') return false;
	try {
		const dep = await apps.readNamespacedDeployment({ namespace: UPCLOUD_AUTOSCALER_NAMESPACE, name: UPCLOUD_AUTOSCALER_DEPLOYMENT });
		return hasUpcloudAutoscalerOwnership(dep.metadata?.labels);
	} catch (err) {
		if (isNotFoundError(err)) return false;
		throw err;
	}
}

export async function teardownUpcloudAutoscaler(kc: KubeConfig, installed = false): Promise<void> {
	if (!installed && !(await detectUpcloudAutoscalerInstalled(kc))) return;

	const core = kc.makeApiClient(CoreV1Api);
	const spinner = p.spinner();
	spinner.start('Removing UpCloud Cluster Autoscaler...');
	try {
		await deleteManifest(kc, renderAutoscalerDeployment({ clusterUuid: 'placeholder', imageTag: 'v1.29.5' }));
		await deleteManifest(kc, clusterAutoscalerRbac);
		try {
			const secret = await core.readNamespacedSecret({ namespace: UPCLOUD_AUTOSCALER_NAMESPACE, name: UPCLOUD_AUTOSCALER_SECRET });
			if (hasUpcloudAutoscalerOwnership(secret.metadata?.labels)) {
				await core.deleteNamespacedSecret({ namespace: UPCLOUD_AUTOSCALER_NAMESPACE, name: UPCLOUD_AUTOSCALER_SECRET });
			}
		} catch (err) {
			if (!isNotFoundError(err)) throw err;
		}
		spinner.stop('UpCloud Cluster Autoscaler removed.');
	} catch (err) {
		spinner.stop('Cluster Autoscaler removal failed.');
		throw err;
	}
}

async function applyUpcloudAutoscalerManifests(
	kc: KubeConfig,
	cfg: { clusterUuid: string; imageTag: string; nodeGroups?: UpcloudNodeGroup[] }
): Promise<void> {
	await applyManifest(kc, clusterAutoscalerRbac, { labels: AUTOSCALER_OWNERSHIP_LABELS });
	await applyManifest(kc, renderAutoscalerDeployment(cfg), { labels: AUTOSCALER_OWNERSHIP_LABELS });
}

export async function ensureAutoscalerSecret(kc: KubeConfig, credentials: { token: string } | { username: string; password: string }): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);
	const stringData: Record<string, string> =
		'token' in credentials ? { token: credentials.token } : { username: credentials.username, password: credentials.password };
	const body = {
		metadata: {
			name: UPCLOUD_AUTOSCALER_SECRET,
			namespace: UPCLOUD_AUTOSCALER_NAMESPACE,
			labels: { ...AUTOSCALER_OWNERSHIP_LABELS }
		},
		type: 'Opaque',
		stringData
	};

	try {
		await api.createNamespacedSecret({ namespace: UPCLOUD_AUTOSCALER_NAMESPACE, body });
	} catch (err) {
		if (!isAlreadyExistsError(err)) throw err;
		const existing = await api.readNamespacedSecret({ namespace: UPCLOUD_AUTOSCALER_NAMESPACE, name: UPCLOUD_AUTOSCALER_SECRET });
		if (!hasUpcloudAutoscalerOwnership(existing.metadata?.labels)) {
			throw new FatalCliError(
				`Secret "${UPCLOUD_AUTOSCALER_SECRET}" already exists in ${UPCLOUD_AUTOSCALER_NAMESPACE} and is not managed by kubwave; refusing to overwrite it.`
			);
		}
		await api.replaceNamespacedSecret({
			namespace: UPCLOUD_AUTOSCALER_NAMESPACE,
			name: UPCLOUD_AUTOSCALER_SECRET,
			body: {
				...body,
				metadata: {
					...body.metadata,
					resourceVersion: existing.metadata?.resourceVersion
				}
			}
		});
	}
}
async function waitForAutoscalerReady(kc: KubeConfig, timeoutMs = 120_000): Promise<void> {
	const apps = kc.makeApiClient(AppsV1Api);
	const deadline = Date.now() + timeoutMs;
	let delay = 500;
	for (;;) {
		try {
			const dep = await apps.readNamespacedDeployment({ namespace: UPCLOUD_AUTOSCALER_NAMESPACE, name: UPCLOUD_AUTOSCALER_DEPLOYMENT });
			if (isDeploymentReady(dep)) return;
		} catch (err) {
			if (Date.now() >= deadline) throw err;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Cluster Autoscaler did not become Ready within ${Math.round(timeoutMs / 1000)}s`);
		}
		await Bun.sleep(delay);
		delay = Math.min(delay * 2, 5000);
	}
}

async function resolveClusterUuid(opts: AutoscalingOpts): Promise<string> {
	if (opts.upcloudClusterUuid?.trim()) return opts.upcloudClusterUuid.trim();

	if (opts.assumeYes) {
		throw new FatalCliError('--yes with --upcloud-autoscaling requires --upcloud-cluster-uuid.');
	}

	const value = await p.text({
		message: 'UpCloud UKS cluster UUID (from the UpCloud Control Panel)',
		validate(input) {
			if (!input?.trim()) return 'Cluster UUID is required';
			if (!UUID_RE.test(input.trim())) return 'Enter a valid UUID (e.g. 01234567-89ab-cdef-0123-456789abcdef)';
		}
	});
	if (p.isCancel(value)) throw new UserCancelledError('Cluster UUID entry aborted.');
	return (value as string).trim();
}

async function resolveCredentials(opts: AutoscalingOpts): Promise<{ token: string } | { username: string; password: string }> {
	// UpCloud API passwords are easily confused with Control Panel login passwords; prefer tokens.
	const token = opts.upcloudToken?.trim() || process.env.UPCLOUD_TOKEN?.trim();
	if (token) return { token };

	const username = opts.upcloudUsername?.trim() || process.env.UPCLOUD_USERNAME?.trim();
	const password = opts.upcloudPassword?.trim() || process.env.UPCLOUD_PASSWORD?.trim();
	if (username && password) return { username, password };

	if (opts.assumeYes) {
		throw new FatalCliError(
			'--yes with --upcloud-autoscaling requires --upcloud-token (or UPCLOUD_TOKEN), or --upcloud-username/--upcloud-password (or UPCLOUD_USERNAME/UPCLOUD_PASSWORD).'
		);
	}

	const promptedToken = await p.password({
		message: 'UpCloud API token',
		validate(input) {
			if (!input?.trim()) return 'API token is required';
		}
	});
	if (p.isCancel(promptedToken)) throw new UserCancelledError('UpCloud API token entry aborted.');

	return { token: (promptedToken as string).trim() };
}

async function resolveNodeGroups(opts: AutoscalingOpts): Promise<UpcloudNodeGroup[]> {
	if (opts.upcloudNodeGroups?.length) return opts.upcloudNodeGroups;
	if (opts.assumeYes) return [];

	const groups: UpcloudNodeGroup[] = [];
	for (;;) {
		const name = await p.text({
			message:
				groups.length === 0
					? 'Node group name to autoscale (press Enter to skip, e.g. "workers")'
					: 'Another node group name (or press Enter to finish)',
			validate(input) {
				if (input && !input.trim()) return 'Name cannot be only whitespace';
				if (input && !NODE_GROUP_NAME_RE.test(input.trim())) return 'Name may only contain letters, digits and hyphens';
			}
		});
		if (p.isCancel(name)) throw new UserCancelledError('Node group entry aborted.');
		if (!name) break;

		const min = await p.text({
			message: `Minimum nodes for "${name}"`,
			validate(input) {
				if (!input) return 'Minimum is required';
				const n = Number(input);
				if (!Number.isInteger(n) || n < 0) return 'Minimum must be a non-negative integer';
			}
		});
		if (p.isCancel(min)) throw new UserCancelledError('Node group entry aborted.');

		const max = await p.text({
			message: `Maximum nodes for "${name}"`,
			validate(input) {
				if (!input) return 'Maximum is required';
				const n = Number(input);
				if (!Number.isInteger(n) || n < Number(min)) return 'Maximum must be an integer >= minimum';
			}
		});
		if (p.isCancel(max)) throw new UserCancelledError('Node group entry aborted.');

		groups.push({ name: name.trim(), min: Number(min), max: Number(max) });
	}

	return groups;
}

async function readClusterKubernetesVersion(kc: KubeConfig): Promise<string | undefined> {
	try {
		const api = kc.makeApiClient(VersionApi);
		const info = await api.getCode();
		return info.gitVersion ?? undefined;
	} catch {
		return undefined;
	}
}

export function resolveAutoscalerImageTag(clusterVersion: string | undefined, override: string | undefined): { tag: string; defaulted: boolean } {
	if (override) return { tag: override, defaulted: false };
	const match = clusterVersion?.match(/^v?(\d+)\.(\d+)/);
	if (!match) return { tag: 'v1.29.5', defaulted: true };
	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major === 1 && minor === 27) return { tag: 'v1.27.8', defaulted: false };
	if (major === 1 && minor === 28) return { tag: 'v1.28.6', defaulted: false };
	if (major === 1 && minor >= 29) return { tag: 'v1.29.5', defaulted: false };
	return { tag: 'v1.29.5', defaulted: true };
}

function validateClusterUuid(clusterUuid: string): void {
	if (!UUID_RE.test(clusterUuid)) {
		throw new FatalCliError(`Invalid UpCloud cluster UUID "${clusterUuid}". Expected a UUID.`);
	}
}
