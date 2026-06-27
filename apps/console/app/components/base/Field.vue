<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { inject } from 'vue';
import type { AnyFieldApi } from '@tanstack/vue-form';
import { APP_FORM_KEY, toComponentField, showFieldError } from './form-context';

// Terse field: injects the form from <AppForm>, renders a TanStack field, and exposes a
// vee-validate-shaped `componentField` so call-sites stay `<Input v-bind="componentField"/>`.
defineProps<{ name: string; label?: string; description?: string; class?: HTMLAttributes['class'] }>();

const form = inject(APP_FORM_KEY);
if (!form) throw new Error('<Field> must be used inside <AppForm>');
</script>

<template>
	<component :is="(form as any).Field" :name="name">
		<template #default="{ field }">
			<FormItem :class="$props.class">
				<FormLabel v-if="label" :invalid="showFieldError(field as AnyFieldApi)">{{ label }}</FormLabel>
				<FormControl :invalid="showFieldError(field as AnyFieldApi)">
					<slot v-bind="{ componentField: toComponentField(field as AnyFieldApi), value: (field as AnyFieldApi).state.value }" />
				</FormControl>
				<FormDescription v-if="description">{{ description }}</FormDescription>
				<FormMessage :errors="(field as AnyFieldApi).state.meta.errors" :show="showFieldError(field as AnyFieldApi)" />
			</FormItem>
		</template>
	</component>
</template>
