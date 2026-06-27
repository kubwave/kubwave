<script setup lang="ts">
import { fractionalX, nearestIndex, seriesDomain, type ChartMarker, type MetricPoint } from '~/utils/metrics-chart';

// Dependency-free SVG time-series chart: plots by real timestamp, overlays deploy markers, nearest-point hover readout.
const props = withDefaults(
	defineProps<{
		points: MetricPoint[];
		markers?: ChartMarker[];
		format?: (v: number) => string;
		formatTime?: (epochSec: number) => string;
		large?: boolean;
		class?: string;
	}>(),
	{ markers: () => [], large: false }
);

const hoverX = ref<number | null>(null);

const w = 100;
const h = computed(() => (props.large ? 120 : 48));
const heightClass = computed(() => (props.large ? 'h-64' : 'h-16'));

const domain = computed(() => seriesDomain(props.points));

const min = computed(() => Math.min(...props.points.map(p => p.v)));
const max = computed(() => Math.max(...props.points.map(p => p.v)));
const span = computed(() => max.value - min.value || 1);

function x(t: number) {
	return fractionalX(t, domain.value!.start, domain.value!.end) * w;
}
function y(v: number) {
	return h.value - ((v - min.value) / span.value) * h.value;
}
// Percent positions for HTML dot overlays, kept out of the SVG so `preserveAspectRatio="none"` can't stretch circles into ovals.
function leftPct(t: number) {
	return fractionalX(t, domain.value!.start, domain.value!.end) * 100;
}
function topPct(v: number) {
	return (1 - (v - min.value) / span.value) * 100;
}

const single = computed(() => props.points.length < 2);
const line = computed(() => (single.value ? '' : props.points.map(p => `${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ')));
const area = computed(() => (single.value ? '' : `0,${h.value} ${line.value} ${w},${h.value}`));

const hoveredIdx = computed(() => (hoverX.value == null ? -1 : nearestIndex(props.points, hoverX.value)));
const hovered = computed(() => (hoveredIdx.value >= 0 ? props.points[hoveredIdx.value]! : null));
const hoveredFrac = computed(() => (hovered.value ? fractionalX(hovered.value.t, domain.value!.start, domain.value!.end) : 0));
const nearMarker = computed(() => (hovered.value ? props.markers.find(m => Math.abs(m.x - hoveredFrac.value) < 0.04) : undefined));

function onMove(e: MouseEvent) {
	const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
	if (rect.width === 0) return;
	hoverX.value = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}
</script>

<template>
	<div v-if="!domain" :class="['flex items-center justify-center text-xs text-muted-foreground', heightClass, props.class]">No data in range</div>

	<div v-else :class="['relative', props.class]" @mousemove="onMove" @mouseleave="hoverX = null">
		<svg :viewBox="`0 0 ${w} ${h}`" preserveAspectRatio="none" :class="['w-full', heightClass]" aria-hidden>
			<polygon v-if="!single" :points="area" fill="currentColor" class="opacity-[0.08]" />
			<line
				v-for="(marker, i) in markers"
				:key="`${marker.id}-${i}`"
				:x1="(marker.x * w).toFixed(2)"
				:x2="(marker.x * w).toFixed(2)"
				:y1="0"
				:y2="h"
				stroke="currentColor"
				:stroke-width="1"
				stroke-dasharray="3 2"
				class="text-foreground/45"
				vector-effect="non-scaling-stroke"
			/>
			<polyline
				v-if="!single"
				:points="line"
				fill="none"
				stroke="currentColor"
				:stroke-width="1.5"
				stroke-linejoin="round"
				stroke-linecap="round"
				vector-effect="non-scaling-stroke"
			/>
			<line
				v-if="hovered"
				:x1="x(hovered.t)"
				:x2="x(hovered.t)"
				:y1="0"
				:y2="h"
				stroke="currentColor"
				:stroke-width="1"
				class="text-foreground/25"
				vector-effect="non-scaling-stroke"
			/>
		</svg>

		<!-- Dots as HTML overlays (fixed px size) so they stay circular despite the stretched SVG. -->
		<div
			v-if="single"
			:class="['pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-current', large ? 'size-2' : 'size-1.5']"
			:style="{ left: `${leftPct(points[0]!.t)}%`, top: `${topPct(points[0]!.v)}%` }"
		/>
		<div
			v-if="hovered"
			:class="['pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-current', large ? 'size-2.5' : 'size-2']"
			:style="{ left: `${leftPct(hovered.t)}%`, top: `${topPct(hovered.v)}%` }"
		/>

		<div
			v-if="format && !single"
			class="pointer-events-none absolute inset-0 flex flex-col justify-between py-0.5 text-[0.65rem] tabular-nums text-muted-foreground"
		>
			<span>{{ format(max) }}</span>
			<span>{{ format(min) }}</span>
		</div>

		<!-- Deploy-id labels along the top, maximized view only (small charts have no room). -->
		<template v-if="large">
			<div
				v-for="(marker, i) in markers"
				:key="`label-${marker.id}-${i}`"
				class="pointer-events-none absolute top-0 -translate-x-1/2 font-mono text-[0.6rem] text-muted-subtle"
				:style="{ left: `${marker.x * 100}%` }"
			>
				{{ marker.id.slice(0, 8) }}
			</div>
		</template>

		<div
			v-if="hovered"
			class="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-background px-2 py-1 text-[0.7rem] shadow-sm"
			:style="{ left: `${Math.min(85, Math.max(15, hoveredFrac * 100))}%` }"
		>
			<div class="font-medium tabular-nums text-foreground">{{ format ? format(hovered.v) : hovered.v }}</div>
			<div v-if="formatTime" class="text-muted-foreground">{{ formatTime(hovered.t) }}</div>
			<div v-if="nearMarker" class="mt-0.5 border-t pt-0.5 text-muted-foreground">
				deploy <span class="font-mono">{{ nearMarker.id.slice(0, 8) }}</span> · {{ nearMarker.status }}
			</div>
		</div>
	</div>
</template>
