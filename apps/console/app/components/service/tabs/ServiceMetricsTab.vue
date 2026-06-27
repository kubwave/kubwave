<script setup lang="ts">
import { Cpu, Loader2, MemoryStick, Network } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import { formatBytes, percentOf } from '~/utils/format';
import { formatCpu, formatRate, makeMetricsTimeFormatter } from '~/utils/metrics-format';
import { deployMarkers, seriesDomain, type MetricsRange } from '~/utils/metrics-chart';

// CPU/Memory/Network/PV cards with a live (kubelet snapshot) vs historical (Prometheus) mode and a 1h/24h/7d range switcher.
const props = defineProps<{ service: Service; active: boolean }>();

const RANGES: MetricsRange[] = ['1h', '24h', '7d'];

const range = ref<MetricsRange>('1h');
const serviceId = computed(() => props.service.id);
const { metrics, isLoading, liveSeries, liveRxRate, liveTxRate } = useServiceMetrics(serviceId, () => props.active, range);
const { deployments } = useServiceDeployments(serviceId);

const live = computed(() => metrics.value?.mode === 'live');
const formatTime = computed(() => makeMetricsTimeFormatter(range.value));

// Live mode plots the client-buffered in-session series; historical plots the server series.
const cpuPoints = computed(() => (live.value ? liveSeries.value.cpuMillicores : (metrics.value?.series.cpuMillicores ?? [])));
const memPoints = computed(() => (live.value ? liveSeries.value.memoryBytes : (metrics.value?.series.memoryBytes ?? [])));
const rxPoints = computed(() => (live.value ? liveSeries.value.networkRxBytes : (metrics.value?.series.networkRxBytes ?? [])));

const current = computed(() => metrics.value?.current);
const limits = computed(() => metrics.value?.limits);
// Live shows the latest derived rate (null until two samples); historical uses the server's current rate.
const rxValue = computed(() => (live.value ? liveRxRate.value : (current.value?.networkRxBytes ?? null)));
const txValue = computed(() => (live.value ? liveTxRate.value : (current.value?.networkTxBytes ?? null)));

// Deploy markers share the chart's time domain.
const markers = computed(() => deployMarkers(deployments.value, seriesDomain(cpuPoints.value)));

const replicaWord = computed(() => (metrics.value && 'replicas' in metrics.value && metrics.value.replicas === 1 ? 'pod' : 'pods'));
</script>

<template>
	<div v-if="isLoading && !metrics" class="flex items-center gap-2 py-10 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" />
		Loading metrics…
	</div>

	<div v-else-if="!metrics || !metrics.available" class="flex flex-col gap-4">
		<!-- Live mode returns one snapshot regardless of range, so the switcher is pointless there. -->
		<div v-if="metrics?.mode !== 'live'" class="flex justify-end">
			<div class="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
				<button
					v-for="r in RANGES"
					:key="r"
					type="button"
					:class="[
						'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
						range === r ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
					]"
					@click="range = r"
				>
					{{ r }}
				</button>
			</div>
		</div>
		<div class="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
			No metrics in this range yet. Prometheus may still be warming up, or the service has not run during this window.
		</div>
	</div>

	<div v-else class="flex flex-col gap-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3 text-xs text-muted-foreground">
				<span>{{ live ? `${metrics.replicas} ${replicaWord} · live snapshot` : 'Historical · Prometheus' }}</span>
				<span v-if="markers.length > 0" class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-px border-l border-dashed border-foreground/45" />
					{{ markers.length === 1 ? 'deploy' : `${markers.length} deploys` }}
				</span>
			</div>
			<!-- No range switcher in live mode — a single snapshot is range-independent. -->
			<div v-if="!live" class="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
				<button
					v-for="r in RANGES"
					:key="r"
					type="button"
					:class="[
						'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
						range === r ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
					]"
					@click="range = r"
				>
					{{ r }}
				</button>
			</div>
		</div>

		<p v-if="live" class="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
			Live usage · sampled every 10s in this session. Enable the managed Prometheus for persisted history across the 1h/24h/7d ranges.
		</p>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<ServiceMetricCard
				v-if="current && limits"
				:icon="Cpu"
				label="CPU"
				:value="formatCpu(current.cpuMillicores)"
				:limit-text="limits.cpuMillicores != null ? formatCpu(limits.cpuMillicores) : null"
				:percent="percentOf(current.cpuMillicores, limits.cpuMillicores)"
				color-class="text-primary"
				:points="cpuPoints"
				:markers="markers"
				:format="formatCpu"
				:format-time="formatTime"
			/>
			<ServiceMetricCard
				v-if="current && limits"
				:icon="MemoryStick"
				label="Memory"
				:value="formatBytes(current.memoryBytes)"
				:limit-text="limits.memoryBytes != null ? formatBytes(limits.memoryBytes) : null"
				:percent="percentOf(current.memoryBytes, limits.memoryBytes)"
				color-class="text-indigo-500"
				:points="memPoints"
				:markers="markers"
				:format="formatBytes"
				:format-time="formatTime"
			/>
			<ServiceMetricCard
				:icon="Network"
				label="Network"
				color-class="text-sky-500"
				:points="rxPoints"
				:markers="markers"
				:format="formatRate"
				:format-time="formatTime"
			>
				<template #value>
					<span class="flex items-baseline gap-3">
						<span class="flex items-baseline gap-1">
							<span class="text-xs font-normal text-muted-foreground">↓</span>
							{{ formatRate(rxValue) }}
						</span>
						<span class="flex items-baseline gap-1 text-muted-foreground">
							<span class="text-xs font-normal">↑</span>
							{{ formatRate(txValue) }}
						</span>
					</span>
				</template>
			</ServiceMetricCard>
			<ServiceVolumesCard v-if="current" :volumes="current.volumes" />
		</div>
	</div>
</template>
