import { inject } from 'vue';
import { FORM_ITEM_INJECTION_KEY } from './injectionKeys';

// After the TanStack migration, field state (error/touched) flows via props from <Field>.
// useFormField now only resolves the a11y ids that link label ↔ control ↔ message.
export function useFormField() {
	const id = inject(FORM_ITEM_INJECTION_KEY);
	return {
		id,
		formItemId: `${id}-form-item`,
		formDescriptionId: `${id}-form-item-description`,
		formMessageId: `${id}-form-item-message`
	};
}
