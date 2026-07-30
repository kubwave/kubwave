<script setup lang="ts">
import { formatBytes } from '~/utils/format';
import { formatCpu, makeMetricsTimeFormatter } from '~/utils/metrics-format';
import type { MetricsRange } from '~/utils/metrics-chart';

const props = defineProps<{ name: string }>();

const range = ref<MetricsRange>('1h');
const { usage } = useClusterNodeUsage(() => props.name, range);

const available = computed(() => usage.value?.available === true);
const formatTime = computed(() => makeMetricsTimeFormatter(range.value));
const diskPoints = computed(() => usage.value?.series.diskBytes ?? []);
</script>

<template>
	<div class="flex flex-col gap-4">
		<div class="flex items-center justify-between gap-3">
			<p class="text-xs text-muted-foreground">{{ available ? 'Historical · Prometheus' : 'No stored history' }}</p>
			<MetricsRangeTabs v-model="range" />
		</div>

		<p v-if="!available" class="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
			Enable the managed Prometheus to see this node's usage across the 1h/24h/7d ranges. Conditions, pods and events below do not need it.
		</p>

		<div v-else class="grid gap-3 lg:grid-cols-2">
			<div class="rounded-xl border bg-card p-4 shadow-xs">
				<p class="text-sm font-medium">Workload CPU</p>
				<UiTimeSeriesChart
					class="mt-3 text-primary"
					:points="usage?.series.cpuMillicores ?? []"
					:format="formatCpu"
					:format-time="formatTime"
					large
				/>
			</div>
			<div class="rounded-xl border bg-card p-4 shadow-xs">
				<p class="text-sm font-medium">Workload memory</p>
				<UiTimeSeriesChart
					class="mt-3 text-indigo-500"
					:points="usage?.series.memoryBytes ?? []"
					:format="formatBytes"
					:format-time="formatTime"
					large
				/>
			</div>
			<div v-if="diskPoints.length > 0" class="rounded-xl border bg-card p-4 shadow-xs">
				<p class="text-sm font-medium">Disk</p>
				<UiTimeSeriesChart class="mt-3 text-amber-500" :points="diskPoints" :format="formatBytes" :format-time="formatTime" large />
			</div>
		</div>
	</div>
</template>
