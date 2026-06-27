<script setup lang="ts">
import type { Component } from 'vue';
import { Maximize2 } from 'lucide-vue-next';
import type { ChartMarker, MetricPoint } from '~/utils/metrics-chart';

// `value` is a slot so the Network card can render its dual ↓/↑ readout. `icon` is a lucide component.
defineProps<{
	icon: Component;
	label: string;
	value?: string;
	limitText?: string | null;
	percent?: number | null;
	colorClass: string;
	points: MetricPoint[];
	markers: ChartMarker[];
	format: (v: number) => string;
	formatTime: (epochSec: number) => string;
}>();
</script>

<template>
	<div class="group rounded-xl bg-muted/30 px-4 py-3">
		<div class="flex items-center justify-between">
			<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<component :is="icon" :class="['size-3.5', colorClass]" />
				{{ label }}
			</span>
			<div class="flex items-center gap-2">
				<span v-if="limitText" class="font-mono text-xs text-muted-foreground">limit {{ limitText }}</span>
				<Dialog>
					<DialogTrigger as-child>
						<button
							type="button"
							class="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
							:aria-label="`Maximize ${label} chart`"
						>
							<Maximize2 class="size-3.5" />
						</button>
					</DialogTrigger>
					<DialogContent class="sm:max-w-3xl">
						<DialogHeader>
							<DialogTitle class="flex items-center gap-2">
								<component :is="icon" :class="['size-4', colorClass]" />
								{{ label }}
							</DialogTitle>
						</DialogHeader>
						<div :class="['pt-2', colorClass]">
							<UiTimeSeriesChart :points="points" :markers="markers" :format="format" :format-time="formatTime" large />
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</div>
		<div class="mt-1 text-lg font-semibold tabular-nums">
			<slot name="value">{{ value }}</slot>
		</div>
		<div :class="['mt-1', colorClass]">
			<UiTimeSeriesChart :points="points" :markers="markers" :format="format" :format-time="formatTime" />
		</div>
		<div v-if="percent != null" class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
			<div :class="['h-full rounded-full bg-current', colorClass]" :style="{ width: `${percent}%` }" />
		</div>
	</div>
</template>
