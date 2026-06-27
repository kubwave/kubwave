import { describe, expect, test } from 'bun:test';
import * as z from 'zod';
import { toComponentField, showFieldError } from '../../app/components/base/form-context';
import { useAppForm } from '../../app/composables/use-app-form';

// A minimal fake field matching the shape toComponentField/showFieldError read.
function fakeField(value: unknown, meta: { isTouched: boolean; errors: unknown[] }) {
	const calls: { change: unknown[]; blur: number } = { change: [], blur: 0 };
	return {
		field: {
			name: 'email',
			state: { value, meta },
			handleChange: (v: unknown) => calls.change.push(v),
			handleBlur: () => {
				calls.blur++;
			}
		},
		calls
	};
}

describe('toComponentField', () => {
	test('maps TanStack field to a v-model-shaped object', () => {
		const { field, calls } = fakeField('hi', { isTouched: false, errors: [] });
		const cf = toComponentField(field as never);
		expect(cf.name).toBe('email');
		expect(cf.modelValue).toBe('hi');
		cf['onUpdate:modelValue']('next');
		expect(calls.change).toEqual(['next']);
		cf.onBlur();
		expect(calls.blur).toBe(1);
	});
});

describe('showFieldError', () => {
	test('false until touched, true when touched with errors', () => {
		expect(showFieldError(fakeField('', { isTouched: false, errors: ['x'] }).field as never)).toBe(false);
		expect(showFieldError(fakeField('', { isTouched: true, errors: [] }).field as never)).toBe(false);
		expect(showFieldError(fakeField('', { isTouched: true, errors: ['x'] }).field as never)).toBe(true);
	});
});

describe('useAppForm', () => {
	test('validates via the zod schema on submit and blocks invalid submit', async () => {
		let submitted: unknown = null;
		const { form } = useAppForm({
			schema: z.object({ email: z.string().email('bad') }),
			defaultValues: { email: 'not-an-email' },
			onSubmit: async ({ value }) => {
				submitted = value;
			}
		});
		await form.handleSubmit();
		expect(submitted).toBeNull(); // invalid → onSubmit not called
		expect(form.state.fieldMeta.email?.errors?.length ?? 0).toBeGreaterThan(0);
	});

	test('applies zod transforms (.trim) to the value passed to onSubmit', async () => {
		let submitted: { name: string } | null = null;
		const { form } = useAppForm({
			schema: z.object({ name: z.string().trim().min(1) }),
			defaultValues: { name: '  hello  ' },
			onSubmit: async ({ value }) => {
				submitted = value as { name: string };
			}
		});
		await form.handleSubmit();
		expect(submitted).not.toBeNull();
		expect(submitted!.name).toBe('hello');
	});

	test('setFieldError surfaces a message on the field', () => {
		const { form, setFieldError } = useAppForm({
			schema: z.object({ email: z.string() }),
			defaultValues: { email: 'a@b.c' },
			onSubmit: async () => {}
		});
		setFieldError('email', 'taken');
		const errs = form.state.fieldMeta.email?.errors ?? [];
		expect(errs.some(e => (typeof e === 'string' ? e : (e as { message?: string })?.message) === 'taken')).toBe(true);
	});
});
