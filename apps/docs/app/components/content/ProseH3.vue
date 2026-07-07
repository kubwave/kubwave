<script setup lang="ts">
defineProps<{
	readonly id?: string;
}>();
</script>

<template>
	<ProseHeading as="h3" :id="id" class="mt-8 text-xl">
		<slot />
	</ProseHeading>
</template>
