// Client-only in-memory access token. The HttpOnly refresh_token cookie is the durable credential;
// this module is the single in-memory source the browser API client reads/writes.
let accessToken: string | null = null;
let inFlight: Promise<string | null> | null = null;

export function getAccessToken(): string | null {
	return accessToken;
}

export function setAccessToken(token: string | null): void {
	accessToken = token;
}

// Concurrent callers (e.g. parallel 401s) share one request: the API rotates the refresh cookie
// on every call, so racing refreshes would present an already-rotated cookie.
export function refreshAccessToken(): Promise<string | null> {
	inFlight ??= exchangeRefreshCookie().finally(() => (inFlight = null));
	return inFlight;
}

const sessionLostListeners = new Set<() => void>();

// Fires when the API rejects the refresh cookie (expired or revoked), so the UI can sign out.
// Network errors and 5xx don't count: the session may still be valid.
export function onSessionLost(listener: () => void): () => void {
	sessionLostListeners.add(listener);
	return () => sessionLostListeners.delete(listener);
}

async function exchangeRefreshCookie(): Promise<string | null> {
	try {
		const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
		if (res.status === 401) {
			accessToken = null;
			for (const listener of sessionLostListeners) listener();
			return null;
		}
		if (!res.ok) return (accessToken = null);
		const data = (await res.json()) as { accessToken?: unknown };
		accessToken = typeof data.accessToken === 'string' ? data.accessToken : null;
		return accessToken;
	} catch {
		return (accessToken = null);
	}
}
