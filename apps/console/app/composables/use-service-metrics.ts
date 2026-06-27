import { useQuery } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';
import { deriveRateSeries, pollIntervalForRange, type MetricPoint, type MetricsRange } from '~/utils/metrics-chart';
import type { ServiceMetrics } from '~/utils/types';

// ~15 min of history at the 10s live poll; live mode has no server-side history, so we buffer client-side.
const MAX_SAMPLES = 90;

interface LiveSample {
	t: number; // epoch seconds
	cpu: number;
	mem: number;
	rx: number; // cumulative
	tx: number; // cumulative
}

export interface LiveSeries {
	cpuMillicores: MetricPoint[];
	memoryBytes: MetricPoint[];
	networkRxBytes: MetricPoint[];
	networkTxBytes: MetricPoint[];
}

export interface ServiceMetricsView {
	metrics: ComputedRef<ServiceMetrics | undefined>;
	isLoading: Ref<boolean>;
	// In-session rolling series for live mode (empty in historical mode); network series are per-second rates from the cumulative counters.
	liveSeries: ComputedRef<LiveSeries>;
	liveRxRate: ComputedRef<number | null>;
	liveTxRate: ComputedRef<number | null>;
}

// Live (kubelet) responses are single-point, so we buffer them into a rolling series and derive network rates client-side; polling is mode/range-aware.
export function useServiceMetrics(
	serviceId: MaybeRefOrGetter<string | null | undefined>,
	active: MaybeRefOrGetter<boolean>,
	range: MaybeRefOrGetter<MetricsRange> = '1h'
): ServiceMetricsView {
	const api = useApi();

	const { data, isPending } = useQuery({
		queryKey: computed(() => queryKeys.serviceMetrics(toValue(serviceId) ?? 'none', toValue(range))),
		enabled: computed(() => Boolean(toValue(serviceId)) && toValue(active)),
		refetchInterval: query => (query.state.data?.mode === 'live' ? 10_000 : pollIntervalForRange(toValue(range))),
		queryFn: async () => {
			const id = toValue(serviceId);
			return apiData(api.services(id!).metrics.get({ range: toValue(range) })).catch(() => {
				throw new Error('Failed to load metrics');
			});
		}
	});

	const samples = ref<LiveSample[]>([]);
	// Non-reactive mutable: dedupe key, never rendered.
	let lastSampledAt: string | null = null;

	// Reset the buffer on service change so one service's history never bleeds into another.
	watch(
		() => toValue(serviceId),
		() => {
			samples.value = [];
			lastSampledAt = null;
		}
	);

	// Append each new live sample (dedupe by sampledAt). Historical mode carries its own series.
	watch(data, value => {
		if (!value || value.mode !== 'live' || !value.available) return;
		if (lastSampledAt === value.sampledAt) return;
		lastSampledAt = value.sampledAt;
		const sample: LiveSample = {
			t: Math.floor(new Date(value.sampledAt).getTime() / 1000),
			cpu: value.current.cpuMillicores,
			mem: value.current.memoryBytes,
			rx: value.current.networkRxBytes,
			tx: value.current.networkTxBytes
		};
		samples.value = [...samples.value, sample].slice(-MAX_SAMPLES);
	});

	const liveSeries = computed<LiveSeries>(() => ({
		cpuMillicores: samples.value.map(s => ({ t: s.t, v: s.cpu })),
		memoryBytes: samples.value.map(s => ({ t: s.t, v: s.mem })),
		networkRxBytes: deriveRateSeries(samples.value.map(s => ({ t: s.t, v: s.rx }))),
		networkTxBytes: deriveRateSeries(samples.value.map(s => ({ t: s.t, v: s.tx })))
	}));

	return {
		metrics: computed(() => data.value),
		isLoading: isPending,
		liveSeries,
		liveRxRate: computed(() => liveSeries.value.networkRxBytes.at(-1)?.v ?? null),
		liveTxRate: computed(() => liveSeries.value.networkTxBytes.at(-1)?.v ?? null)
	};
}
