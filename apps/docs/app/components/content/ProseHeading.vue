<script setup lang="ts">
defineProps<{
	readonly as: string;
	readonly id?: string;
}>();
</script>

<template>
	<component :is="as" :id="id" class="group scroll-mt-24 font-semibold tracking-tight text-foreground">
		<a v-if="id" :href="`#${id}`" class="rounded-sm no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
			<slot />
		</a>
		<slot v-else />
	</component>
</template>
