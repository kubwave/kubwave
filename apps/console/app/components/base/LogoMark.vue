<script setup lang="ts">
// Decorative brand mark; the adjacent wordmark conveys the name. Size via the `class` prop.
defineProps<{ class?: string }>();
</script>

<template>
	<img src="/logo.png" alt="" aria-hidden="true" width="28" height="28" :class="['size-7 object-contain', $props.class]" />
</template>
