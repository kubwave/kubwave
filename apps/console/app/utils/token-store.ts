// Client-only in-memory access token. The HttpOnly refresh_token cookie is the durable credential;
// this module is the single in-memory source the browser API client reads/writes.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
	return accessToken;
}

export function setAccessToken(token: string | null): void {
	accessToken = token;
}

// Send the HttpOnly refresh cookie; on success API returns a fresh access token + rotates cookie.
export async function refreshAccessToken(): Promise<string | null> {
	try {
		const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
		if (!res.ok) {
			accessToken = null;
			return null;
		}
		const data = (await res.json()) as { accessToken?: unknown };
		accessToken = typeof data.accessToken === 'string' ? data.accessToken : null;
		return accessToken;
	} catch {
		accessToken = null;
		return null;
	}
}
