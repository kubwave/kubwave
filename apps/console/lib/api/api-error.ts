// Backend errors use the shape { error: string, details?: unknown }. Pull the code out of a thrown error.
export function errorCode(err: unknown): string {
	if (err && typeof err === 'object') {
		const value = (err as Record<string, unknown>).error;
		if (typeof value === 'string') return value;
	}
	return 'unknown';
}

// Shared service create/save error message: the duplicate-name case gets a specific message, errors with a
// user-facing `details.message` (e.g. an invalid service reference) show it, everything else gets the caller's fallback.
export function serviceErrorMessage(err: unknown, fallback = 'Could not save service.'): string {
	if (errorCode(err) === 'service_name_taken') return 'A service with that name already exists.';
	const details = err && typeof err === 'object' ? (err as { details?: { message?: unknown } }).details : undefined;
	return typeof details?.message === 'string' ? details.message : fallback;
}
