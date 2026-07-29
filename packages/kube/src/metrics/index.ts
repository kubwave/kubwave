import type * as k8s from '@kubernetes/client-node';
import { pvcName, WORKLOADS_NAMESPACE_PREFIX } from '../workloads/index';

// Kubelet Summary API (/stats/summary) via apiserver node proxy; unlike metrics-server it carries per-pod CPU, memory, network, and PVC usage.

// Subset of the kubelet Summary API we consume; the kubelet returns far more.
export interface KubeletVolumeStats {
	name?: string;
	time?: string;
	usedBytes?: number;
	capacityBytes?: number;
	availableBytes?: number;
	pvcRef?: { name?: string; namespace?: string };
}

export interface KubeletPodStats {
	podRef?: { name?: string; namespace?: string };
	cpu?: { usageNanoCores?: number };
	memory?: { workingSetBytes?: number };
	network?: { rxBytes?: number; txBytes?: number };
	volume?: KubeletVolumeStats[];
}

// The kubelet's own roll-up for the node, distinct from the sum of its pods: it includes system-daemon overhead outside any container.
export interface KubeletNodeStats {
	nodeName?: string;
	cpu?: { usageNanoCores?: number };
	memory?: { workingSetBytes?: number };
	fs?: { capacityBytes?: number; usedBytes?: number };
}

export interface NodeStatsSummary {
	node?: KubeletNodeStats;
	pods?: KubeletPodStats[];
}

// Fetch one node's kubelet stats via the apiserver node proxy.
export async function nodeStatsSummary(api: k8s.CoreV1Api, nodeName: string): Promise<NodeStatsSummary> {
	const raw = await api.connectGetNodeProxyWithPath({ name: nodeName, path: 'stats/summary' });
	return (typeof raw === 'string' ? JSON.parse(raw) : raw) as NodeStatsSummary;
}

export function parseCpuToMillicores(quantity: string | undefined | null): number | null {
	if (!quantity) return null;
	const q = quantity.trim();
	if (q.endsWith('m')) {
		const n = Number(q.slice(0, -1));
		return Number.isFinite(n) ? n : null;
	}
	const n = Number(q);
	return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

const BINARY_SUFFIXES: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
const DECIMAL_SUFFIXES: Record<string, number> = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

export function parseMemoryToBytes(quantity: string | undefined | null): number | null {
	if (!quantity) return null;
	const q = quantity.trim();
	for (const [suffix, factor] of Object.entries(BINARY_SUFFIXES)) {
		if (q.endsWith(suffix)) {
			const n = Number(q.slice(0, -suffix.length));
			return Number.isFinite(n) ? Math.round(n * factor) : null;
		}
	}
	for (const [suffix, factor] of Object.entries(DECIMAL_SUFFIXES)) {
		if (q.endsWith(suffix)) {
			const n = Number(q.slice(0, -suffix.length));
			return Number.isFinite(n) ? Math.round(n * factor) : null;
		}
	}
	const n = Number(q);
	return Number.isFinite(n) ? Math.round(n) : null;
}

export interface ServicePodRef {
	name: string;
	// The node the pod runs on; the caller uses it to decide which summaries to fetch.
	nodeName: string | null;
}

// Limit fields read off the service config; kept local so kube stays decoupled from the db/api schemas.
export interface ServiceUsageLimits {
	cpuLimit?: string;
	memoryLimit?: string;
}

export interface ServiceVolumeUsage {
	name: string;
	usedBytes: number;
	capacityBytes: number;
}

export interface ServiceUsage {
	// True when we matched kubelet stats for at least one of the service's pods.
	available: boolean;
	// Number of the service's running pods we found stats for.
	replicas: number;
	cpuMillicores: number;
	memoryBytes: number;
	// Cumulative byte counters since pod start; the caller derives a rate from deltas.
	networkRxBytes: number;
	networkTxBytes: number;
	volumes: ServiceVolumeUsage[];
	cpuLimitMillicores: number | null;
	memoryLimitBytes: number | null;
}

export function aggregateServiceUsage(args: {
	serviceId: string;
	namespace: string;
	pods: ServicePodRef[];
	summaries: NodeStatsSummary[];
	limits?: ServiceUsageLimits;
}): ServiceUsage {
	const { serviceId, namespace, pods, summaries, limits } = args;

	// Index pod stats by namespace/name to avoid collisions across tenant namespaces.
	const statsByKey = new Map<string, KubeletPodStats>();
	for (const summary of summaries) {
		for (const pod of summary.pods ?? []) {
			const ns = pod.podRef?.namespace;
			const name = pod.podRef?.name;
			if (ns && name) statsByKey.set(`${ns}/${name}`, pod);
		}
	}

	const volumes = new Map<string, ServiceVolumeUsage>();
	let cpuMillicores = 0;
	let memoryBytes = 0;
	let networkRxBytes = 0;
	let networkTxBytes = 0;
	let matched = 0;

	for (const pod of pods) {
		const stats = statsByKey.get(`${namespace}/${pod.name}`);
		if (!stats) continue;
		matched++;
		cpuMillicores += (stats.cpu?.usageNanoCores ?? 0) / 1e6;
		memoryBytes += stats.memory?.workingSetBytes ?? 0;
		networkRxBytes += stats.network?.rxBytes ?? 0;
		networkTxBytes += stats.network?.txBytes ?? 0;

		for (const vol of stats.volume ?? []) {
			const volName = serviceVolumeNameFromPvc(serviceId, vol.pvcRef?.name);
			if (!volName) continue;
			const existing = volumes.get(volName) ?? { name: volName, usedBytes: 0, capacityBytes: 0 };
			existing.usedBytes += vol.usedBytes ?? 0;
			existing.capacityBytes = Math.max(existing.capacityBytes, vol.capacityBytes ?? 0);
			volumes.set(volName, existing);
		}
	}

	return {
		available: matched > 0,
		replicas: matched,
		cpuMillicores,
		memoryBytes,
		networkRxBytes,
		networkTxBytes,
		volumes: [...volumes.values()].sort((a, b) => a.name.localeCompare(b.name)),
		cpuLimitMillicores: parseCpuToMillicores(limits?.cpuLimit),
		memoryLimitBytes: parseMemoryToBytes(limits?.memoryLimit)
	};
}

// Reverse of pvcName(): `svc-<serviceId>-<vol>` -> `<vol>`; null when the PVC isn't one of this service's volumes.
export function serviceVolumeNameFromPvc(serviceId: string, claimName: string | undefined): string | null {
	if (!claimName) return null;
	const prefix = pvcName(serviceId, '');
	return claimName.startsWith(prefix) ? claimName.slice(prefix.length) : null;
}

export function emptyServiceUsage(limits?: ServiceUsageLimits): ServiceUsage {
	return {
		available: false,
		replicas: 0,
		cpuMillicores: 0,
		memoryBytes: 0,
		networkRxBytes: 0,
		networkTxBytes: 0,
		volumes: [],
		cpuLimitMillicores: parseCpuToMillicores(limits?.cpuLimit),
		memoryLimitBytes: parseMemoryToBytes(limits?.memoryLimit)
	};
}

export interface ClusterNodeUsage {
	nodeName: string;
	// False when the kubelet reported no cpu/memory for the node, so callers render "unknown" instead of a misleading 0.
	available: boolean;
	cpuMillicores: number;
	memoryBytes: number;
	fsUsedBytes: number;
	fsCapacityBytes: number;
}

export interface WorkloadUsage {
	cpuMillicores: number;
	memoryBytes: number;
}

export interface ClusterUsageAggregate {
	nodes: ClusterNodeUsage[];
	volumeUsedBytes: number;
	volumeCapacityBytes: number;
	platform: WorkloadUsage;
	tenants: WorkloadUsage;
	// Everything that is neither the platform namespace nor a tenant namespace (kube-system, ingress, cert-manager).
	other: WorkloadUsage;
}

export function aggregateClusterUsage(args: { summaries: NodeStatsSummary[]; platformNamespace: string }): ClusterUsageAggregate {
	const { summaries, platformNamespace } = args;

	const nodes: ClusterNodeUsage[] = [];
	const platform: WorkloadUsage = { cpuMillicores: 0, memoryBytes: 0 };
	const tenants: WorkloadUsage = { cpuMillicores: 0, memoryBytes: 0 };
	const other: WorkloadUsage = { cpuMillicores: 0, memoryBytes: 0 };
	// Keyed by namespace/claim so a ReadWriteMany volume mounted by several pods is counted once.
	const claims = new Map<string, { usedBytes: number; capacityBytes: number }>();

	for (const summary of summaries) {
		const node = summary.node;
		if (node?.nodeName) {
			nodes.push({
				nodeName: node.nodeName,
				available: node.cpu?.usageNanoCores != null || node.memory?.workingSetBytes != null,
				cpuMillicores: (node.cpu?.usageNanoCores ?? 0) / 1e6,
				memoryBytes: node.memory?.workingSetBytes ?? 0,
				fsUsedBytes: node.fs?.usedBytes ?? 0,
				fsCapacityBytes: node.fs?.capacityBytes ?? 0
			});
		}

		for (const pod of summary.pods ?? []) {
			const namespace = pod.podRef?.namespace;
			if (!namespace) continue;

			const bucket = namespace === platformNamespace ? platform : namespace.startsWith(WORKLOADS_NAMESPACE_PREFIX) ? tenants : other;
			bucket.cpuMillicores += (pod.cpu?.usageNanoCores ?? 0) / 1e6;
			bucket.memoryBytes += pod.memory?.workingSetBytes ?? 0;

			for (const volume of pod.volume ?? []) {
				const claimName = volume.pvcRef?.name;
				if (!claimName) continue;
				claims.set(`${volume.pvcRef?.namespace ?? namespace}/${claimName}`, {
					usedBytes: volume.usedBytes ?? 0,
					capacityBytes: volume.capacityBytes ?? 0
				});
			}
		}
	}

	let volumeUsedBytes = 0;
	let volumeCapacityBytes = 0;
	for (const claim of claims.values()) {
		volumeUsedBytes += claim.usedBytes;
		volumeCapacityBytes += claim.capacityBytes;
	}

	return { nodes, volumeUsedBytes, volumeCapacityBytes, platform, tenants, other };
}
