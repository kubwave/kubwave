import type { ComputedRef, InjectionKey } from 'vue';

// The settings form validates a plain reactive draft against the Zod schema and provides the
// flat `path -> message` map here, so every section can surface its own field errors without a
// vee-validate context (whose readonly `values` can't hold the dynamic env/secret/volume arrays).
export const SERVICE_SETTINGS_ERRORS: InjectionKey<ComputedRef<Record<string, string>>> = Symbol('service-settings-errors');

export function useServiceSettingsError(name: MaybeRefOrGetter<string>) {
	const errors = inject(SERVICE_SETTINGS_ERRORS, undefined);
	return computed(() => errors?.value[toValue(name)]);
}
