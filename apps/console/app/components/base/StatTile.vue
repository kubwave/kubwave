<script setup lang="ts">
import type { Component } from 'vue';

// Icon + label + big tabular value. One tile for dashboard and admin stats so they can't drift.
defineProps<{ label: string; value: number | string; icon: Component; pending?: boolean; to?: string }>();

const NuxtLink = resolveComponent('NuxtLink');
</script>

<template>
	<component
		:is="to ? NuxtLink : 'div'"
		:to="to"
		:class="['block rounded-xl border bg-card p-4 shadow-xs', to ? 'transition-shadow hover:shadow-md' : '']"
	>
		<span class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
			<component :is="icon" class="size-4" />
			{{ label }}
		</span>
		<Skeleton v-if="pending" class="mt-2 h-8 w-10" />
		<p v-else class="mt-2 text-2xl font-semibold tabular-nums">{{ value }}</p>
	</component>
</template>
