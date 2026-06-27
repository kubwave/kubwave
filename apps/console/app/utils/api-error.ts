// Backend errors use the shape { error: string, details?: unknown }. Pull the code out of a thrown error.
export function errorCode(err: unknown): string {
	if (err && typeof err === 'object') {
		const value = (err as Record<string, unknown>).error;
		if (typeof value === 'string') return value;
	}
	return 'unknown';
}

// Shared service create/save error message: the duplicate-name case gets a specific message, everything
// else gets the caller's fallback. Centralised so the wording lives in one place across the service forms.
export function serviceErrorMessage(err: unknown, fallback = 'Could not save service.'): string {
	return errorCode(err) === 'service_name_taken' ? 'A service with that name already exists.' : fallback;
}
