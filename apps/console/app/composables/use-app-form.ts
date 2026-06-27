import type { Ref } from 'vue';
import type { AnyFormApi } from '@tanstack/vue-form';
import type { ZodType } from 'zod';
import { useForm } from '@tanstack/vue-form';

interface UseAppFormOptions<TValues extends Record<string, unknown>> {
	schema: ZodType;
	defaultValues: TValues;
	onSubmit: (ctx: { value: TValues }) => unknown | Promise<unknown>;
}

export function useAppForm<TValues extends Record<string, unknown>>(
	opts: UseAppFormOptions<TValues>
): {
	form: AnyFormApi;
	isSubmitting: Readonly<Ref<boolean>>;
	// Plain { value } wrapper (not Ref) so vue-tsc doesn't auto-unwrap it in templates; callers use values.value.X.
	values: { readonly value: TValues };
	setFieldValue: (name: keyof TValues & string, value: unknown) => void;
	setFieldError: (name: string, message: string) => void;
} {
	// zod 3.25 is a Standard Schema (pass straight to TanStack); onSubmit re-parses so zod transforms (e.g. .trim()) reach the payload.
	const formApi = useForm({
		defaultValues: opts.defaultValues,
		validators: { onBlur: opts.schema as never, onSubmit: opts.schema as never },
		onSubmit: ({ value }) => opts.onSubmit({ value: opts.schema.parse(value) as TValues })
	});

	// TanStack's Vue form methods aren't on the AnyFormApi alias; the casts live here once so the rest of the app gets typed accessors.
	const api = formApi as unknown as {
		useStore: <T>(selector: (state: { isSubmitting: boolean; values: TValues }) => T) => Readonly<Ref<T>>;
		setFieldValue: (name: string, value: unknown) => void;
		setFieldMeta: (name: string, updater: (prev: Record<string, unknown> | undefined) => Record<string, unknown>) => void;
	};

	const isSubmitting = api.useStore(state => state.isSubmitting);

	// Runtime value is a Vue Ref but exposed as a plain { value } wrapper so vue-tsc doesn't auto-unwrap it in templates.
	const values = api.useStore(state => state.values) as unknown as { readonly value: TValues };

	const form = formApi as unknown as AnyFormApi;

	function setFieldValue(name: keyof TValues & string, value: unknown) {
		api.setFieldValue(name, value);
	}

	function setFieldError(name: string, message: string) {
		// Fall back to a minimal meta only for the rare not-yet-registered field; TanStack derives errors from errorMap.
		api.setFieldMeta(name, prev => ({
			...(prev ?? { isTouched: false, isBlurred: false, isDirty: false, isValidating: false, errorMap: {} }),
			isTouched: true,
			errorMap: { ...(prev?.errorMap as Record<string, unknown>), onSubmit: message }
		}));
	}

	return { form, isSubmitting, values, setFieldValue, setFieldError };
}
