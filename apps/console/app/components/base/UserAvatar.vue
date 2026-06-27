<script setup lang="ts">
import { cn } from '~/lib/utils';

// Initials monogram (up to 2 initials from name || email) — no image source in this product.
const props = defineProps<{ name?: string | null; email?: string | null; class?: string }>();

const initials = computed(() => {
	const seed = (props.name || props.email || '?').trim();
	return (
		seed
			.split(/\s+/)
			.slice(0, 2)
			.map(part => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
});
</script>

<template>
	<Avatar :class="cn('size-8 shrink-0 select-none', props.class)" aria-hidden="true">
		<AvatarFallback class="bg-muted text-xs font-medium text-muted-foreground">{{ initials }}</AvatarFallback>
	</Avatar>
</template>
