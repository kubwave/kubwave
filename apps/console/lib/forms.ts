type FieldMeta = { isTouched: boolean; errors: readonly unknown[] };

function messageOf(error: unknown): string | undefined {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
	return undefined;
}

// The message to show under a form field: only after the user interacted with it (a submit touches every field).
export function fieldError(meta: FieldMeta): string | undefined {
	if (!meta.isTouched) return undefined;
	return meta.errors.map(messageOf).find(message => message !== undefined);
}
