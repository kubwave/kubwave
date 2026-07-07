<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next';

const props = defineProps<{
	readonly href?: string;
}>();

const isExternal = computed(() => props.href?.startsWith('http') ?? false);
</script>

<template>
	<a
		v-if="isExternal"
		:href="href"
		target="_blank"
		rel="noreferrer"
		class="inline-flex items-center gap-1 font-medium text-primary-text underline decoration-primary/40 underline-offset-4 transition-colors hover:text-primary"
	>
		<slot />
		<ExternalLink class="size-3" aria-hidden="true" />
	</a>
	<NuxtLink
		v-else
		:to="href ?? '/'"
		class="font-medium text-primary-text underline decoration-primary/40 underline-offset-4 transition-colors hover:text-primary"
	>
		<slot />
	</NuxtLink>
</template>
