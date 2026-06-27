<script setup lang="ts">
import type { Component } from 'vue';
import { AlertTriangle, Ban, CheckCircle2, Loader2, XCircle } from 'lucide-vue-next';
import type { DeploymentLog } from '~/utils/types';

// Vertical timeline of deployment events; the raw step slug only selects the node icon and is never shown.
const props = defineProps<{
	logs: DeploymentLog[];
	deploying?: boolean;
}>();

type Node = { icon: Component | null; class: string; spin: boolean };

function nodeFor(log: DeploymentLog, isLast: boolean): Node {
	if (log.step === 'succeeded') return { icon: CheckCircle2, class: 'text-success-foreground', spin: false };
	if (log.step === 'failed' || log.level === 'error') return { icon: XCircle, class: 'text-destructive', spin: false };
	if (log.step === 'canceled') return { icon: Ban, class: 'text-muted-foreground', spin: false };
	if (log.level === 'warn') return { icon: AlertTriangle, class: 'text-warning', spin: false };
	if (props.deploying && isLast) return { icon: Loader2, class: 'text-muted-foreground', spin: true };
	return { icon: null, class: 'text-muted-subtle', spin: false };
}

function formatLogTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const rows = computed(() =>
	props.logs.map((log, index) => {
		const isLast = index === props.logs.length - 1;
		return { key: `${log.ts}-${log.step}-${index}`, log, time: formatLogTime(log.ts), node: nodeFor(log, isLast), isLast };
	})
);

// Anchor the build slot to the "building" event so it stays put (anchoring to the last build event makes it
// jump once "Built and pushed image…" appears); fall back to the first build-phase event when there's no `building` step.
const BUILD_STEPS = new Set(['build-started', 'building', 'pushing', 'build-succeeded']);
const buildAnchorIndex = computed(() => {
	const building = props.logs.findIndex(log => log.step === 'building');
	return building >= 0 ? building : props.logs.findIndex(log => BUILD_STEPS.has(log.step));
});
const buildAnchorIsLast = computed(() => buildAnchorIndex.value === props.logs.length - 1);
</script>

<template>
	<ul class="flex flex-col">
		<template v-for="(row, index) in rows" :key="row.key">
			<li class="flex gap-3">
				<div class="flex w-4 flex-col items-center">
					<component :is="row.node.icon" v-if="row.node.icon" :class="['mt-0.5 size-4 shrink-0', row.node.class, row.node.spin && 'animate-spin']" />
					<span v-else :class="['mt-1.5 size-1.5 shrink-0 rounded-full bg-current', row.node.class]" />
					<span v-if="!row.isLast || index === buildAnchorIndex" class="mt-1 w-px flex-1 bg-gray-200 dark:bg-gray-800" />
				</div>
				<div class="flex min-w-0 flex-1 items-baseline gap-2 pb-3">
					<span class="min-w-0 flex-1 text-xs wrap-break-word text-foreground/90">{{ row.log.message }}</span>
					<span class="shrink-0 font-mono text-[0.7rem] text-muted-foreground tabular-nums">{{ row.time }}</span>
				</div>
			</li>
			<li v-if="index === buildAnchorIndex" class="flex gap-3">
				<div class="flex w-4 justify-center">
					<span v-if="!buildAnchorIsLast" class="w-px self-stretch bg-gray-200 dark:bg-gray-800" />
				</div>
				<div class="min-w-0 flex-1 pb-3">
					<slot name="build" />
				</div>
			</li>
		</template>
	</ul>
</template>
