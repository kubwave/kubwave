<script setup lang="ts">
// Brand lockup: the mark plus an optional monochrome wordmark.
withDefaults(defineProps<{ class?: string; showText?: boolean }>(), { showText: true });
</script>

<template>
	<span :class="['inline-flex items-center gap-2.5', $props.class]">
		<LogoMark />
		<span v-if="showText" class="text-[0.95rem] font-semibold tracking-tight text-foreground">kubwave</span>
	</span>
</template>
