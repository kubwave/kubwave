import type { InjectionKey } from 'vue';
import type { AnyFieldApi, AnyFormApi } from '@tanstack/vue-form';

// Provided by <AppForm>, injected by <Field>.
export const APP_FORM_KEY: InjectionKey<AnyFormApi> = Symbol('app-form');

// Adapt a TanStack field into a vee-validate-shaped `componentField` so existing `<Input v-bind="componentField"/>` call-sites keep working.
export function toComponentField(field: AnyFieldApi) {
	return {
		name: field.name as string,
		modelValue: field.state.value,
		'onUpdate:modelValue': (value: unknown) => field.handleChange(value as never),
		onBlur: () => field.handleBlur()
	};
}

// Only display a field's error once the user has interacted with it.
export function showFieldError(field: AnyFieldApi): boolean {
	return field.state.meta.isTouched && field.state.meta.errors.length > 0;
}
