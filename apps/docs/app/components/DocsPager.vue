<script setup lang="ts">
import { ArrowLeft, ArrowRight } from 'lucide-vue-next';
import type { Pager } from '~/utils/navigation';

defineProps<{
	readonly pager: Pager;
}>();
</script>

<template>
	<nav class="mt-12 grid gap-3 border-t pt-8 sm:grid-cols-2" aria-label="Docs pagination">
		<NuxtLink
			v-if="pager.previous"
			:to="pager.previous.path"
			class="group rounded-xl border bg-card p-4 transition-[border-color,background-color] hover:border-primary/60 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
		>
			<span class="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
				<ArrowLeft class="size-4" /> Previous
			</span>
			<span class="mt-2 block font-medium group-hover:text-primary-text">{{ pager.previous.title }}</span>
		</NuxtLink>
		<div v-else />
		<NuxtLink
			v-if="pager.next"
			:to="pager.next.path"
			class="group rounded-xl border bg-card p-4 text-right transition-[border-color,background-color] hover:border-primary/60 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
		>
			<span class="flex items-center justify-end gap-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
				Next <ArrowRight class="size-4" />
			</span>
			<span class="mt-2 block font-medium group-hover:text-primary-text">{{ pager.next.title }}</span>
		</NuxtLink>
	</nav>
</template>
