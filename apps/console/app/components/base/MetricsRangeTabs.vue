<script setup lang="ts">
import type { MetricsRange } from '~/utils/metrics-chart';

const RANGES: MetricsRange[] = ['1h', '24h', '7d'];

const model = defineModel<MetricsRange>({ required: true });
</script>

<template>
	<div class="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
		<button
			v-for="option in RANGES"
			:key="option"
			type="button"
			:class="[
				'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
				model === option ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
			]"
			@click="model = option"
		>
			{{ option }}
		</button>
	</div>
</template>
