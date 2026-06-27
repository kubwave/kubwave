import { INTERNAL_API_URL } from './config';

// Server-side auth helpers for the Nitro middleware: fetch-only, no DB or JWT secret.

export interface RefreshedSession {
	accessToken: string;
	// Raw Set-Cookie strings from the API's rotation, relayed to the browser.
	setCookies: string[];
}

// Exchange the refresh_token cookie for a fresh access token (API rotates + returns Set-Cookie); null when no valid session.
export async function refreshSession(refreshToken: string | undefined): Promise<RefreshedSession | null> {
	if (!refreshToken) return null;
	try {
		const res = await fetch(`${INTERNAL_API_URL}/api/auth/refresh`, {
			method: 'POST',
			headers: { cookie: `refresh_token=${refreshToken}` },
			cache: 'no-store'
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { accessToken?: unknown };
		if (typeof data.accessToken !== 'string') return null;
		return { accessToken: data.accessToken, setCookies: res.headers.getSetCookie() };
	} catch {
		return null;
	}
}

// Whether the first admin exists yet (drives the login-vs-setup redirect).
export async function fetchSetupStatus(): Promise<{ initialized: boolean; registryConfigured: boolean }> {
	try {
		const res = await fetch(`${INTERNAL_API_URL}/api/setup/status`, { cache: 'no-store' });
		if (!res.ok) return { initialized: false, registryConfigured: false };
		const data = (await res.json()) as { initialized?: unknown; registryConfigured?: unknown };
		return { initialized: data.initialized === true, registryConfigured: data.registryConfigured === true };
	} catch {
		return { initialized: false, registryConfigured: false };
	}
}
