<script setup lang="ts">
defineProps<{
	readonly id?: string;
}>();
</script>

<template>
	<ProseHeading as="h2" :id="id" class="mt-12 text-2xl">
		<slot />
	</ProseHeading>
</template>
