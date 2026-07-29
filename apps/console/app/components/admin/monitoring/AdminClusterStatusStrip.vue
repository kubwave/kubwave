<script setup lang="ts">
import { Boxes, Cpu, HardDrive, MemoryStick } from 'lucide-vue-next';
import { formatBytes } from '~/utils/format';
import { formatCpu } from '~/utils/metrics-format';
import type { ClusterSnapshot } from '~/utils/types';

const props = defineProps<{ snapshot: ClusterSnapshot | undefined; pending: boolean }>();

const state = computed(() => props.snapshot?.state ?? 'unknown');

const headline = computed(() => {
	if (state.value === 'ok') return 'Cluster healthy';
	if (state.value === 'degraded') return 'Cluster degraded';
	return 'Cluster status unknown';
});

const tone = computed(() => {
	if (state.value === 'ok') return { dot: 'bg-success', border: 'border-success/25', bg: 'bg-success/8' };
	if (state.value === 'degraded') return { dot: 'bg-warning', border: 'border-warning/25', bg: 'bg-warning/8' };
	return { dot: 'bg-muted-foreground', border: 'border-border', bg: 'bg-muted/30' };
});

const nodesText = computed(() => {
	const snapshot = props.snapshot;
	if (!snapshot) return 'Reading cluster…';
	if (!snapshot.available) return 'The cluster could not be reached';
	return `${snapshot.nodesReady} of ${snapshot.nodesTotal} ${snapshot.nodesTotal === 1 ? 'node' : 'nodes'} ready`;
});

const tiles = computed(() => {
	const snapshot = props.snapshot;
	if (!snapshot) return [];
	return [
		{ key: 'cpu', label: 'CPU', icon: Cpu, meter: snapshot.cpu, format: formatCpu },
		{ key: 'memory', label: 'Memory', icon: MemoryStick, meter: snapshot.memory, format: formatBytes },
		{ key: 'storage', label: 'Storage', icon: HardDrive, meter: snapshot.storage, format: formatBytes },
		{ key: 'pods', label: 'Pods', icon: Boxes, meter: snapshot.pods, format: (value: number) => String(Math.round(value)) }
	];
});
</script>

<template>
	<div :class="['flex flex-col gap-4 rounded-xl border p-4 shadow-xs', tone.border, tone.bg]">
		<div class="flex items-center gap-2.5">
			<span :class="['size-2 shrink-0 rounded-full', tone.dot]" aria-hidden="true" />
			<p class="text-sm font-semibold">{{ headline }}</p>
			<p class="truncate text-sm text-muted-foreground">· {{ nodesText }}</p>
		</div>

		<div v-if="pending && !snapshot" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<div v-for="i in 4" :key="`skeleton-${i}`" class="rounded-lg border bg-card p-3">
				<Skeleton class="h-3 w-16" />
				<Skeleton class="mt-3 h-4 w-24" />
			</div>
		</div>

		<div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<div v-for="tile in tiles" :key="tile.key" class="rounded-lg border bg-card p-3">
				<div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<component :is="tile.icon" class="size-3.5 shrink-0" />
					{{ tile.label }}
				</div>
				<AdminClusterResourceMeter class="mt-2" :meter="tile.meter" :format="tile.format" />
			</div>
		</div>
	</div>
</template>
