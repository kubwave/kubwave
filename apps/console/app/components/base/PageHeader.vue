<script setup lang="ts">
// Shared page header: title + optional description + right-aligned actions, with one consistent
// title-to-subtitle rhythm. Use the #breadcrumb slot above the title (project detail) and #actions on the right.
defineProps<{ title?: string; description?: string }>();
</script>

<template>
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div class="min-w-0">
			<slot name="breadcrumb" />
			<h1 class="text-2xl font-semibold tracking-tight">
				<slot name="title">{{ title }}</slot>
			</h1>
			<p v-if="description || $slots.description" class="mt-1.5 text-sm text-muted-foreground">
				<slot name="description">{{ description }}</slot>
			</p>
		</div>
		<div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
			<slot name="actions" />
		</div>
	</div>
</template>
