<script setup lang="ts">
import { formatBytes } from '~/utils/format';
import { formatCpu, makeMetricsTimeFormatter } from '~/utils/metrics-format';
import type { MetricsRange } from '~/utils/metrics-chart';
import type { ClusterSnapshot } from '~/utils/types';

const props = defineProps<{ snapshot: ClusterSnapshot | undefined; active: boolean }>();

const RANGES: MetricsRange[] = ['1h', '24h', '7d'];

const range = ref<MetricsRange>('1h');
const { usage, liveSeries } = useClusterUsage(
	range,
	() => props.active,
	() => props.snapshot
);

const historical = computed(() => usage.value?.available === true);
const formatTime = computed(() => makeMetricsTimeFormatter(range.value));

const cpuPoints = computed(() => (historical.value ? (usage.value?.series.cpuMillicores ?? []) : liveSeries.value.cpuMillicores));
const memoryPoints = computed(() => (historical.value ? (usage.value?.series.memoryBytes ?? []) : liveSeries.value.memoryBytes));

const split = computed(() => {
	const value = props.snapshot?.split;
	if (!value) return null;

	const total = value.platform.cpuMillicores + value.tenants.cpuMillicores + value.other.cpuMillicores;
	if (total <= 0) return null;

	return {
		total,
		segments: [
			{ key: 'platform', label: 'Platform', usage: value.platform, tone: 'bg-primary' },
			{ key: 'tenants', label: 'Tenants', usage: value.tenants, tone: 'bg-indigo-500' },
			{ key: 'other', label: 'Other', usage: value.other, tone: 'bg-muted-foreground/50' }
		].map(segment => ({ ...segment, percent: (segment.usage.cpuMillicores / total) * 100 }))
	};
});
</script>

<template>
	<div class="flex flex-col gap-4">
		<div class="flex items-center justify-between gap-3">
			<p class="text-xs text-muted-foreground">{{ historical ? 'Historical · Prometheus' : 'Live · in-session buffer' }}</p>
			<div v-if="historical" class="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
				<button
					v-for="option in RANGES"
					:key="option"
					type="button"
					:class="[
						'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
						range === option ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
					]"
					@click="range = option"
				>
					{{ option }}
				</button>
			</div>
		</div>

		<p v-if="!historical" class="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
			Live usage · sampled every 15s in this session. Enable the managed Prometheus for persisted history across the 1h/24h/7d ranges.
		</p>

		<div class="grid gap-3 lg:grid-cols-2">
			<div class="rounded-xl border bg-card p-4 shadow-xs">
				<p class="text-sm font-medium">Workload CPU</p>
				<UiTimeSeriesChart class="mt-3 text-primary" :points="cpuPoints" :format="formatCpu" :format-time="formatTime" large />
			</div>
			<div class="rounded-xl border bg-card p-4 shadow-xs">
				<p class="text-sm font-medium">Workload memory</p>
				<UiTimeSeriesChart class="mt-3 text-indigo-500" :points="memoryPoints" :format="formatBytes" :format-time="formatTime" large />
			</div>
		</div>

		<p class="text-xs text-muted-subtle">
			History covers container usage only, so it reads below the node totals in the strip above, which include system-daemon overhead.
		</p>

		<div v-if="split" class="rounded-xl border bg-card p-4 shadow-xs">
			<p class="text-sm font-medium">Platform vs. tenants</p>
			<div class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
				<div
					v-for="segment in split.segments"
					:key="segment.key"
					:class="['transition-[width] duration-500 ease-out', segment.tone]"
					:style="{ width: `${segment.percent}%` }"
				/>
			</div>
			<div class="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
				<div v-for="segment in split.segments" :key="segment.key" class="flex items-center gap-2 text-xs">
					<span :class="['size-2 shrink-0 rounded-full', segment.tone]" aria-hidden="true" />
					<span class="font-medium">{{ segment.label }}</span>
					<span class="text-muted-foreground tabular-nums">
						{{ segment.percent.toFixed(0) }}% · {{ formatCpu(segment.usage.cpuMillicores) }} · {{ formatBytes(segment.usage.memoryBytes) }}
					</span>
				</div>
			</div>
		</div>
	</div>
</template>
