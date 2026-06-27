<script setup lang="ts">
import type { Component } from 'vue';

// Shared zero-data state: icon medallion + title + optional description + action slot.
// `page` = dashed bordered block for a whole surface; `inline` = quieter, for inside a card/table.
withDefaults(defineProps<{ icon?: Component; title: string; description?: string; variant?: 'page' | 'inline' }>(), { variant: 'page' });
</script>

<template>
	<div :class="['flex flex-col items-center text-center', variant === 'page' ? 'rounded-xl border border-dashed px-4 py-16' : 'px-4 py-12']">
		<div v-if="icon" class="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground/70">
			<component :is="icon" class="size-6" />
		</div>
		<p class="mt-4 text-sm font-medium">{{ title }}</p>
		<p v-if="description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
		<div v-if="$slots.action" class="mt-5">
			<slot name="action" />
		</div>
	</div>
</template>
