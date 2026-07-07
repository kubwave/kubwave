<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next';

defineProps<{
	readonly title: string;
	readonly to: string;
	readonly description: string;
}>();
</script>

<template>
	<NuxtLink
		:to="to"
		class="group block rounded-xl border bg-card p-5 transition-[border-color,background-color] hover:border-primary/60 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
	>
		<span class="flex items-center justify-between gap-3 font-semibold text-foreground">
			{{ title }}
			<ArrowRight class="size-4 text-muted-foreground transition-colors group-hover:text-primary-text" />
		</span>
		<span class="mt-2 block text-sm leading-6 text-muted-foreground">{{ description }}</span>
	</NuxtLink>
</template>
