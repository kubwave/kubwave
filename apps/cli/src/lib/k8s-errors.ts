// Helpers for @kubernetes/client-node errors. The library changed shape between v0.x
// (err.response.statusCode) and v1.x (err.code); some failures only surface in the body.

interface MaybeKubeError {
	code?: number;
	statusCode?: number;
	response?: { statusCode?: number; body?: unknown };
	body?: unknown;
	message?: string;
}

function asObj(err: unknown): MaybeKubeError | null {
	return typeof err === 'object' && err !== null ? (err as MaybeKubeError) : null;
}

function bodyAsObject(body: unknown): Record<string, unknown> | null {
	if (typeof body === 'string') {
		try {
			const parsed = JSON.parse(body);
			return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	}
	if (typeof body === 'object' && body !== null) return body as Record<string, unknown>;
	return null;
}

export function getStatusCode(err: unknown): number | undefined {
	const o = asObj(err);
	if (!o) return undefined;
	if (typeof o.code === 'number') return o.code;
	if (typeof o.statusCode === 'number') return o.statusCode;
	if (typeof o.response?.statusCode === 'number') return o.response.statusCode;

	const body = bodyAsObject(o.response?.body ?? o.body);
	if (body && typeof body['code'] === 'number') return body['code'] as number;
	return undefined;
}

export function getStatusBody(err: unknown): unknown {
	const o = asObj(err);
	if (!o) return undefined;
	return o.response?.body ?? o.body;
}

export function isNotFoundError(err: unknown): boolean {
	return getStatusCode(err) === 404;
}

function getStatusMessage(err: unknown): string | undefined {
	const body = bodyAsObject(getStatusBody(err));
	if (body && typeof body['message'] === 'string') return body['message'];
	const o = asObj(err);
	return typeof o?.message === 'string' ? o.message : undefined;
}

// The apiserver wraps every admission-webhook *connectivity* failure as `failed calling webhook "<name>"`
// (dial timeout, no ready endpoints, EOF). A webhook that answers with a denial reads `admission webhook
// "<name>" denied the request` instead — that one is a real rejection, not an unready cluster.
export function isWebhookUnavailableError(err: unknown): boolean {
	return getStatusMessage(err)?.includes('failed calling webhook') ?? false;
}

export function isAlreadyExistsError(err: unknown): boolean {
	return getStatusCode(err) === 409;
}

// On a patch/update a 409 is an optimistic-concurrency conflict (stale resourceVersion), to be retried with fresh state.
export function isConflictError(err: unknown): boolean {
	return getStatusCode(err) === 409;
}
