<script setup lang="ts">
import { percentOf } from '~/utils/format';
import type { ClusterMeter } from '~/utils/types';

const props = defineProps<{ meter: ClusterMeter; format: (value: number) => string; compact?: boolean }>();

const usedPercent = computed(() => (props.meter.used == null ? null : percentOf(props.meter.used, props.meter.capacity)));
const requestedPercent = computed(() => (props.meter.requested == null ? null : percentOf(props.meter.requested, props.meter.capacity)));
const usedText = computed(() => (props.meter.used == null ? '—' : props.format(props.meter.used)));
const capacityText = computed(() => (props.meter.capacity > 0 ? props.format(props.meter.capacity) : '—'));

const barTone = computed(() => {
	const percent = usedPercent.value;
	if (percent == null) return 'bg-muted-foreground/40';
	if (percent >= 90) return 'bg-destructive';
	if (percent >= 75) return 'bg-warning';
	return 'bg-primary';
});
</script>

<template>
	<div class="flex flex-col gap-1">
		<div v-if="!compact" class="flex items-baseline justify-between gap-2 text-sm">
			<span class="font-semibold tabular-nums">{{ usedText }}</span>
			<span class="text-xs text-muted-foreground tabular-nums">of {{ capacityText }}</span>
		</div>

		<div class="relative h-1.5 overflow-hidden rounded-full bg-muted">
			<div
				v-if="usedPercent != null"
				:class="['absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out', barTone]"
				:style="{ width: `${usedPercent}%` }"
			/>
			<!-- The request line is a threshold, not a second fill: it marks what the scheduler has already promised away. -->
			<div
				v-if="requestedPercent != null"
				class="absolute inset-y-0 w-0.5 bg-foreground/50"
				:style="{ left: `calc(${requestedPercent}% - 1px)` }"
				:title="`${format(meter.requested ?? 0)} requested`"
			/>
		</div>

		<p v-if="compact" class="text-xs text-muted-foreground tabular-nums">{{ usedText }} / {{ capacityText }}</p>
	</div>
</template>
