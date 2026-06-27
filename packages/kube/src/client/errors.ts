export function isNotFound(err: unknown): boolean {
	if (!err || typeof err !== 'object') {
		return false;
	}
	const e = err as { code?: unknown; statusCode?: unknown; response?: { statusCode?: unknown; status?: unknown } };
	return e.code === 404 || e.statusCode === 404 || e.response?.statusCode === 404 || e.response?.status === 404;
}

export function isConflict(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const e = err as { code?: unknown; statusCode?: unknown; response?: { statusCode?: unknown; status?: unknown } };
	return e.code === 409 || e.statusCode === 409 || e.response?.statusCode === 409 || e.response?.status === 409;
}
