import { useQuery } from '@tanstack/vue-query';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';
import { pollIntervalForRange, type MetricPoint, type MetricsRange } from '~/utils/metrics-chart';
import type { ClusterEvents, ClusterNodeDetail, ClusterNodeUsage, ClusterSnapshot, ClusterUsage } from '~/utils/types';

// ~22 min of history at the 15s snapshot poll; a live install has no stored series, so the Utilization tab buffers one in-session.
const MAX_SAMPLES = 90;

export function clusterSnapshotQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.clusterSnapshot,
		queryFn: () => apiData(api.platform.cluster.get())
	};
}

export function clusterEventsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.clusterEvents,
		queryFn: () => apiData(api.platform.cluster.events.get())
	};
}

export function clusterUsageQuery(api: ApiClient, range: MetricsRange) {
	return {
		queryKey: queryKeys.clusterUsage(range),
		queryFn: () => apiData(api.platform.cluster.usage.get({ range }))
	};
}

export function useClusterSnapshot() {
	const api = useApi();
	const { data: snapshot, isLoading } = useQuery({
		...clusterSnapshotQuery(api),
		refetchInterval: 15_000,
		refetchOnWindowFocus: true
	});

	return { snapshot: snapshot as Ref<ClusterSnapshot | undefined>, isLoading };
}

export function useClusterEvents(active: MaybeRefOrGetter<boolean>) {
	const api = useApi();
	const { data: events, isLoading } = useQuery({
		...clusterEventsQuery(api),
		enabled: computed(() => toValue(active)),
		refetchInterval: 30_000
	});

	return { events: events as Ref<ClusterEvents | undefined>, isLoading };
}

export interface ClusterLiveSeries {
	cpuMillicores: MetricPoint[];
	memoryBytes: MetricPoint[];
}

export function useClusterUsage(range: MaybeRefOrGetter<MetricsRange>) {
	const api = useApi();
	const { data: usage, isLoading } = useQuery({
		queryKey: computed(() => queryKeys.clusterUsage(toValue(range))),
		refetchInterval: () => pollIntervalForRange(toValue(range)),
		queryFn: () => apiData(api.platform.cluster.usage.get({ range: toValue(range) }))
	});

	return { usage: usage as Ref<ClusterUsage | undefined>, isLoading };
}

export function clusterNodeQuery(api: ApiClient, name: string) {
	return {
		queryKey: queryKeys.clusterNode(name),
		queryFn: () => apiData(api.platform.cluster.nodes(name).get())
	};
}

export function useClusterNode(name: MaybeRefOrGetter<string>) {
	const api = useApi();
	const { data: node, isLoading } = useQuery({
		queryKey: computed(() => queryKeys.clusterNode(toValue(name))),
		queryFn: () => apiData(api.platform.cluster.nodes(toValue(name)).get()),
		refetchInterval: 15_000
	});

	return { node: node as Ref<ClusterNodeDetail | undefined>, isLoading };
}

export function clusterNodeUsageQuery(api: ApiClient, name: string, range: MetricsRange) {
	return {
		queryKey: queryKeys.clusterNodeUsage(name, range),
		queryFn: () => apiData(api.platform.cluster.nodes(name).usage.get({ range }))
	};
}

export function useClusterNodeUsage(name: MaybeRefOrGetter<string>, range: MaybeRefOrGetter<MetricsRange>) {
	const api = useApi();
	const { data: usage } = useQuery({
		queryKey: computed(() => queryKeys.clusterNodeUsage(toValue(name), toValue(range))),
		refetchInterval: () => pollIntervalForRange(toValue(range)),
		queryFn: () => apiData(api.platform.cluster.nodes(toValue(name)).usage.get({ range: toValue(range) }))
	});

	return { usage: usage as Ref<ClusterNodeUsage | undefined> };
}

// Owned above the tab switcher: the buffer is the only copy of this history, so unmounting the chart must not discard it.
export function useClusterLiveSamples(snapshot: MaybeRefOrGetter<ClusterSnapshot | undefined>) {
	const samples = ref<ClusterLiveSeries>({ cpuMillicores: [], memoryBytes: [] });
	let lastSampledAt: string | null = null;

	// Only buffer while Prometheus has nothing to offer; otherwise the server series is authoritative.
	watch(
		() => toValue(snapshot),
		value => {
			if (!value?.available || value.cpu.used == null || value.memory.used == null) return;
			if (lastSampledAt === value.sampledAt) return;
			lastSampledAt = value.sampledAt;

			const t = Math.floor(new Date(value.sampledAt).getTime() / 1000);
			samples.value = {
				cpuMillicores: [...samples.value.cpuMillicores, { t, v: value.cpu.used }].slice(-MAX_SAMPLES),
				memoryBytes: [...samples.value.memoryBytes, { t, v: value.memory.used }].slice(-MAX_SAMPLES)
			};
		},
		{ immediate: true }
	);

	return { liveSeries: computed<ClusterLiveSeries>(() => samples.value) };
}
