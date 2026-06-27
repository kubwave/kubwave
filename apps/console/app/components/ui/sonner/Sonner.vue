<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner';
import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert, X } from 'lucide-vue-next';
import { Toaster as Sonner } from 'vue-sonner';
import 'vue-sonner/style.css';
import { cn } from '~/lib/utils';

const props = defineProps<ToasterProps>();
const colorMode = useColorMode();

// Forward the toaster props minus class (set explicitly below), with the theme bound to color mode.
const forwarded = computed(() => {
	const { class: _class, ...rest } = props;
	return { ...rest, theme: colorMode.value === 'dark' ? ('dark' as const) : ('light' as const) };
});
</script>

<template>
	<Sonner
		:class="cn('toaster group', props.class)"
		:style="{
			'--normal-bg': 'var(--popover)',
			'--normal-text': 'var(--popover-foreground)',
			'--normal-border': 'var(--border)',
			'--border-radius': 'var(--radius)'
		}"
		v-bind="forwarded"
	>
		<template #success-icon><CircleCheck class="size-4" /></template>
		<template #info-icon><Info class="size-4" /></template>
		<template #warning-icon><TriangleAlert class="size-4" /></template>
		<template #error-icon><OctagonX class="size-4" /></template>
		<template #loading-icon><Loader2 class="size-4 animate-spin" /></template>
		<template #close-icon><X class="size-4" /></template>
	</Sonner>
</template>
