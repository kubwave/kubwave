<script setup lang="ts" generic="T extends string">
// Vertical list of selectable option cards with radio semantics.
const model = defineModel<T>({ required: true });
defineProps<{ options: { value: T; label: string; description: string }[] }>();
</script>

<template>
	<div class="flex flex-col gap-2">
		<button
			v-for="option in options"
			:key="option.value"
			type="button"
			class="flex flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left transition-colors"
			:class="model === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'"
			@click="model = option.value"
		>
			<span class="flex items-center gap-2 text-sm font-medium">
				<span
					class="flex size-3.5 items-center justify-center rounded-full border"
					:class="model === option.value ? 'border-primary' : 'border-muted-foreground/40'"
				>
					<span v-if="model === option.value" class="size-1.5 rounded-full bg-primary" />
				</span>
				{{ option.label }}
			</span>
			<span class="pl-5.5 text-xs text-muted-foreground">{{ option.description }}</span>
		</button>
	</div>
</template>
