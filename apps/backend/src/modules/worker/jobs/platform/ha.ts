import {
	AppsV1Api,
	CoreV1Api,
	CustomObjectsApi,
	type KubeConfig,
	type V1Affinity,
	type V1Deployment,
	type V1TopologySpreadConstraint
} from '@kubernetes/client-node';
import { HA_SETTINGS_KEY, PLATFORM_CONFIGMAP_NAME, resolveHaSettings } from '@kubwave/kube';
import { env } from '../../../../shared/config/worker-env.js';
import { CNPG_CLUSTER_NAME, CNPG_GROUP, CNPG_PLURAL, CNPG_VERSION, type CnpgCluster } from './cnpg.js';
import { isNotFound, readConfigMapOrNull, readDeploymentOrNull, retryOnConflict } from '../../../../shared/cluster/ops.js';

// HA reconciler: each tick reads the admin `ha` setting and live-patches api/console Deployments and the CNPG Cluster (worker is excluded — it's a singleton).
// Mirrors ha_enabled into the platform marker so resolveInstallState/helm preserve HA; HA toggles are same-version so helm can't ride them.

const HA_REPLICAS = 3;
const HA_TOPOLOGY_KEY = 'kubernetes.io/hostname';
const HA_COMPONENTS = ['api', 'console'] as const;

const RETRY_ATTEMPTS = 3;

export function desiredReplicas(enabled: boolean): number {
	return enabled ? HA_REPLICAS : 1;
}

export function haAffinity(component: string): V1Affinity {
	return {
		podAntiAffinity: {
			preferredDuringSchedulingIgnoredDuringExecution: [
				{ weight: 100, podAffinityTerm: { topologyKey: HA_TOPOLOGY_KEY, labelSelector: { matchLabels: { 'app.kubernetes.io/name': component } } } }
			]
		}
	};
}

export function haTopologySpread(component: string): V1TopologySpreadConstraint[] {
	return [
		{
			maxSkew: 1,
			topologyKey: HA_TOPOLOGY_KEY,
			whenUnsatisfiable: 'ScheduleAnyway',
			labelSelector: { matchLabels: { 'app.kubernetes.io/name': component } }
		}
	];
}

export function deploymentHaDrift(dep: V1Deployment, enabled: boolean): boolean {
	const replicas = dep.spec?.replicas ?? 1;
	const hasAffinity = Boolean(dep.spec?.template?.spec?.affinity?.podAntiAffinity);
	const hasSpread = (dep.spec?.template?.spec?.topologySpreadConstraints?.length ?? 0) > 0;
	return replicas !== desiredReplicas(enabled) || hasAffinity !== enabled || hasSpread !== enabled;
}

async function readHaSetting(): Promise<boolean> {
	// Lazy import so the pure helpers above stay importable (and unit-testable) without a DB client.
	const { db, settings } = await import('@kubwave/db');
	const { eq } = await import('drizzle-orm');
	const [row] = await db.select().from(settings).where(eq(settings.key, HA_SETTINGS_KEY)).limit(1);
	return resolveHaSettings(row?.value).enabled;
}

// Read-modify-replace a helm-owned Deployment's replicas + spread on drift; safe because helm re-asserts the same spec on the next marker-driven upgrade.
async function applyDeploymentHa(appsApi: AppsV1Api, namespace: string, component: string, enabled: boolean): Promise<void> {
	await retryOnConflict(`platform-ha: Deployment ${component}`, RETRY_ATTEMPTS, async () => {
		const dep = await readDeploymentOrNull(appsApi, namespace, component);
		if (!dep?.spec?.template?.spec) return; // not deployed yet - next tick
		if (!deploymentHaDrift(dep, enabled)) return; // already converged

		dep.spec.replicas = desiredReplicas(enabled);
		dep.spec.template.spec.affinity = enabled ? haAffinity(component) : undefined;
		dep.spec.template.spec.topologySpreadConstraints = enabled ? haTopologySpread(component) : undefined;

		await appsApi.replaceNamespacedDeployment({ name: component, namespace, body: dep });
	});
}

export function clusterHaDrift(cluster: CnpgCluster, enabled: boolean): boolean {
	const instances = cluster.spec?.instances ?? 1;
	const antiAffinity = cluster.spec?.affinity?.enablePodAntiAffinity ?? false;
	return instances !== desiredReplicas(enabled) || antiAffinity !== enabled;
}

// Scale CNPG instances + pod-anti-affinity on drift via read-modify-replace (avoids the merge-patch content-type dance); absent -> cnpg not in use, skip.
async function applyClusterHa(customApi: CustomObjectsApi, namespace: string, enabled: boolean): Promise<void> {
	await retryOnConflict(`platform-ha: CNPG Cluster ${CNPG_CLUSTER_NAME}`, RETRY_ATTEMPTS, async () => {
		let cluster: CnpgCluster;
		try {
			cluster = (await customApi.getNamespacedCustomObject({
				group: CNPG_GROUP,
				version: CNPG_VERSION,
				namespace,
				plural: CNPG_PLURAL,
				name: CNPG_CLUSTER_NAME
			})) as CnpgCluster;
		} catch (err) {
			if (isNotFound(err)) return; // absent -> external DB / cnpg not in use, so skip
			throw err;
		}

		if (!clusterHaDrift(cluster, enabled)) return;
		cluster.spec = {
			...cluster.spec,
			instances: desiredReplicas(enabled),
			// Preserve operator/chart-set fields; defaults mirror the chart so a later helm upgrade renders the same affinity (no churn).
			affinity: {
				topologyKey: HA_TOPOLOGY_KEY,
				podAntiAffinityType: 'preferred',
				...cluster.spec?.affinity,
				enablePodAntiAffinity: enabled
			}
		};

		await customApi.replaceNamespacedCustomObject({
			group: CNPG_GROUP,
			version: CNPG_VERSION,
			namespace,
			plural: CNPG_PLURAL,
			name: CNPG_CLUSTER_NAME,
			body: cluster
		});
	});
}

// Mirror ha_enabled into the platform marker so resolveInstallState (and the next helm upgrade) renders the same replicas/affinity the worker applied live.
async function mirrorHaMarker(coreApi: CoreV1Api, namespace: string, enabled: boolean): Promise<void> {
	const desired = String(enabled);
	await retryOnConflict(`platform-ha: marker ${PLATFORM_CONFIGMAP_NAME}`, RETRY_ATTEMPTS, async () => {
		const cm = await readConfigMapOrNull(coreApi, namespace, PLATFORM_CONFIGMAP_NAME);
		if (!cm) return; // no marker (e.g. a dev install without platformMarker) - nothing to mirror
		if (cm.data?.['ha_enabled'] === desired) return;
		cm.data = { ...cm.data, ha_enabled: desired };

		await coreApi.replaceNamespacedConfigMap({ name: PLATFORM_CONFIGMAP_NAME, namespace, body: cm });
	});
}

// Converge the control plane to the admin `ha` setting. Idempotent (writes only on drift), HA-safe across replicas (last-writer-wins on identical state).
export async function reconcileHaMode(kc: KubeConfig): Promise<void> {
	const enabled = await readHaSetting();
	const namespace = env.podNamespace;
	const appsApi = kc.makeApiClient(AppsV1Api);
	const coreApi = kc.makeApiClient(CoreV1Api);
	const customApi = kc.makeApiClient(CustomObjectsApi);

	// Record intent in the marker FIRST (non-disruptive) so a later helm upgrade sees the new HA value even if a peer rollout below cuts this tick short.
	await mirrorHaMarker(coreApi, namespace, enabled);

	// Converge the peer Deployments (api/console) and the database; worker is excluded — it's a singleton, so this never touches the pod it runs in.
	for (const component of HA_COMPONENTS) {
		await applyDeploymentHa(appsApi, namespace, component, enabled);
	}
	await applyClusterHa(customApi, namespace, enabled);
}
