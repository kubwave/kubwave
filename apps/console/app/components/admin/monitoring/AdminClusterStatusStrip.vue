<script setup lang="ts">
import type { ClusterSnapshot } from '~/utils/types';

const props = defineProps<{ snapshot: ClusterSnapshot | undefined; pending: boolean }>();

const PRESSURES = [
	['memoryPressure', 'MemoryPressure'],
	['diskPressure', 'DiskPressure'],
	['pidPressure', 'PIDPressure']
] as const;
const MAX_PROBLEMS = 3;

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

// Mirrors the backend's degraded rule, so the strip names what tipped it instead of sending the admin hunting through tabs.
const problemsText = computed(() => {
	const snapshot = props.snapshot;
	if (snapshot?.state !== 'degraded') return '';

	const problems = [
		...snapshot.nodes.flatMap(node => [
			...(node.conditions.ready ? [] : [`${node.name} NotReady`]),
			...PRESSURES.filter(([key]) => node.conditions[key]).map(([, label]) => `${node.name} ${label}`)
		]),
		...snapshot.components
			.filter(component => component.ready < component.desired)
			.map(component => `${component.name} ${component.ready}/${component.desired} ready`)
	];
	const more = problems.length - MAX_PROBLEMS;
	return problems.slice(0, MAX_PROBLEMS).join(', ') + (more > 0 ? ` +${more} more` : '');
});
</script>

<template>
	<div :class="['flex flex-col gap-4 rounded-xl border p-4 shadow-xs', tone.border, tone.bg]">
		<div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
			<span :class="['size-2 shrink-0 rounded-full', tone.dot]" aria-hidden="true" />
			<p class="text-sm font-semibold">{{ headline }}</p>
			<p class="text-sm text-muted-foreground">· {{ nodesText }}</p>
			<p v-if="problemsText" class="text-sm text-warning-foreground">· {{ problemsText }}</p>
		</div>

		<div v-if="pending && !snapshot" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<div v-for="i in 4" :key="`skeleton-${i}`" class="rounded-lg border bg-card p-3">
				<Skeleton class="h-3 w-16" />
				<Skeleton class="mt-3 h-4 w-24" />
			</div>
		</div>

		<AdminClusterMeterTiles
			v-else-if="snapshot"
			:cpu="snapshot.cpu"
			:memory="snapshot.memory"
			:disk="snapshot.storage"
			disk-label="Volumes"
			:pods="snapshot.pods"
		/>
	</div>
</template>
