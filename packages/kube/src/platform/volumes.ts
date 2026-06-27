import type { CoreV1Api, V1Pod } from '@kubernetes/client-node';
import { nodeStatsSummary, type KubeletPodStats, type NodeStatsSummary } from '../metrics/index';

// Cluster-managed PVCs the autoscaler grows (registry, CNPG postgres, managed Prometheus); shared by worker's sweep and api's usage display.

// Mirrors values.yaml registry.storage.pvcName (kept stable across chart upgrades).
export const REGISTRY_PVC_NAME = 'kubwave-registry-data';
// The chart stamps app.kubernetes.io/name=registry on the registry pod.
export const REGISTRY_POD_SELECTOR = 'app.kubernetes.io/name=registry';

// Managed Prometheus is worker-provisioned when metrics.provider=prometheus-managed.
export const PROMETHEUS_NAME = 'kubwave-prometheus';
export const PROMETHEUS_PVC_NAME = 'kubwave-prometheus-data';
export const PROMETHEUS_POD_SELECTOR = `app.kubernetes.io/name=${PROMETHEUS_NAME}`;

// CNPG Cluster name mirrors the chart (templates/postgres/cluster.yaml metadata.name).
export const CNPG_CLUSTER_NAME = 'postgres';
// CNPG labels every instance pod (and its PVC) with cnpg.io/cluster=<cluster>.
export const CNPG_POD_SELECTOR = `cnpg.io/cluster=${CNPG_CLUSTER_NAME}`;
// Matches only data PVCs (<cluster>-<n>); excludes future wal-storage PVCs (<cluster>-<n>-wal).
export const CNPG_DATA_PVC = new RegExp(`^${CNPG_CLUSTER_NAME}-\\d+$`);

export type PlatformVolume = 'registry' | 'postgres' | 'prometheus';

export interface PvcUsage {
	usedBytes: number;
	capacityBytes: number;
	sampledAt?: string;
}

export interface PodRef {
	name: string;
	// The node the pod runs on; picks which node summaries to read.
	nodeName: string | null;
}

// Fullest matching PVC across pod kubelet volume stats (registry's single PVC, or the fullest HA-postgres instance). Pods keyed by namespace/name.
export function fullestPvcUsage(
	namespace: string,
	pods: PodRef[],
	summaries: NodeStatsSummary[],
	wantsPvc: (pvcName: string) => boolean
): PvcUsage | null {
	const statsByKey = new Map<string, KubeletPodStats>();
	for (const summary of summaries) {
		for (const pod of summary.pods ?? []) {
			const ns = pod.podRef?.namespace;
			const name = pod.podRef?.name;
			if (ns && name) statsByKey.set(`${ns}/${name}`, pod);
		}
	}

	let best: PvcUsage | null = null;
	for (const pod of pods) {
		const stats = statsByKey.get(`${namespace}/${pod.name}`);
		for (const vol of stats?.volume ?? []) {
			if (!vol.pvcRef?.name || !wantsPvc(vol.pvcRef.name)) continue;
			if (vol.usedBytes == null || !vol.capacityBytes) continue;
			const candidate: PvcUsage = { usedBytes: vol.usedBytes, capacityBytes: vol.capacityBytes, ...(vol.time ? { sampledAt: vol.time } : {}) };
			if (!best || candidate.usedBytes / candidate.capacityBytes > best.usedBytes / best.capacityBytes) best = candidate;
		}
	}
	return best;
}

// Max-usage stats across pods matched by labelSelector + pvcRef filter; node summaries cached per node so reads share fetches, failed nodes skip.
export async function maxPvcUsage(
	coreApi: CoreV1Api,
	namespace: string,
	labelSelector: string,
	wantsPvc: (pvcName: string) => boolean,
	summaryCache: Map<string, NodeStatsSummary | null>
): Promise<PvcUsage | null> {
	const podList = await coreApi.listNamespacedPod({ namespace, labelSelector });
	const pods: PodRef[] = (podList.items as V1Pod[])
		.map(p => ({ name: p.metadata?.name ?? '', nodeName: p.spec?.nodeName ?? null }))
		.filter(p => p.name.length > 0 && p.nodeName);

	for (const node of new Set(pods.map(p => p.nodeName).filter((n): n is string => Boolean(n)))) {
		if (summaryCache.has(node)) continue;
		try {
			summaryCache.set(node, await nodeStatsSummary(coreApi, node));
		} catch (err) {
			summaryCache.set(node, null); // node summary failed; skip its pods this read
			console.warn(`[platform-volumes] node summary failed for ${node}:`, err);
		}
	}

	const summaries = [...new Set(pods.map(p => p.nodeName).filter((n): n is string => Boolean(n)))]
		.map(node => summaryCache.get(node))
		.filter((s): s is NodeStatsSummary => Boolean(s));
	return fullestPvcUsage(namespace, pods, summaries, wantsPvc);
}

// Read-only fill snapshot; `null` means the volume isn't present (registry off in dev / external DB / Prometheus off) or has no kubelet stats yet.
export async function readPlatformVolumeUsage(coreApi: CoreV1Api, namespace: string): Promise<Record<PlatformVolume, PvcUsage | null>> {
	const summaryCache = new Map<string, NodeStatsSummary | null>();
	const registry = await maxPvcUsage(coreApi, namespace, REGISTRY_POD_SELECTOR, name => name === REGISTRY_PVC_NAME, summaryCache);
	const postgres = await maxPvcUsage(coreApi, namespace, CNPG_POD_SELECTOR, name => CNPG_DATA_PVC.test(name), summaryCache);
	const prometheus = await maxPvcUsage(coreApi, namespace, PROMETHEUS_POD_SELECTOR, name => name === PROMETHEUS_PVC_NAME, summaryCache);
	return { registry, postgres, prometheus };
}
