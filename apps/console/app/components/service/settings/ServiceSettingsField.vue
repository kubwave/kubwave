<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { useServiceSettingsError } from '~/components/service/settings/service-settings-context';

// Label + control + schema message for one field in the settings draft. Mirrors the base <Field>
// look (shadcn FormItem) but pulls its error from the form's injected path->message map rather
// than a vee-validate context, since the big form drives its own Zod validation.
const props = defineProps<{ name: string; label?: string; description?: string; class?: HTMLAttributes['class'] }>();

const error = useServiceSettingsError(() => props.name);
</script>

<template>
	<div class="grid gap-2" :class="$props.class">
		<label v-if="label" class="text-sm leading-none font-medium" :class="error ? 'text-destructive' : undefined">{{ label }}</label>
		<slot />
		<p v-if="description && !error" class="text-xs text-muted-foreground">{{ description }}</p>
		<p v-if="error" class="text-xs text-destructive">{{ error }}</p>
	</div>
</template>
