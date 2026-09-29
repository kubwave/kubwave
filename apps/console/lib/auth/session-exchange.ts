import { internalApiUrl } from '../server-config';
import type { SetupStatus } from './route-policy';

// Server-side auth calls for the proxy: fetch-only, no database or JWT secret.

export type RefreshedSession = {
	accessToken: string;
	// Raw Set-Cookie strings from the API's rotation, relayed to the browser.
	setCookies: string[];
};

// These run on every page load, so a hung API must not hang the page.
const API_TIMEOUT_MS = 5_000;

export async function refreshSession(refreshToken: string | undefined): Promise<RefreshedSession | null> {
	if (!refreshToken) return null;
	try {
		const res = await fetch(`${internalApiUrl()}/api/auth/refresh`, {
			method: 'POST',
			headers: { cookie: `refresh_token=${refreshToken}` },
			cache: 'no-store',
			signal: AbortSignal.timeout(API_TIMEOUT_MS)
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { accessToken?: unknown };
		if (typeof data.accessToken !== 'string') return null;
		return { accessToken: data.accessToken, setCookies: res.headers.getSetCookie() };
	} catch {
		return null;
	}
}

// An unreachable API (e.g. restarting during a self-update) reads as "set up": the status only
// steers redirects, and bouncing signed-in users to the setup page would be wrong. The setup API
// itself refuses once the platform is initialized.
const ASSUME_SET_UP: SetupStatus = { initialized: true, registryConfigured: true };

export async function fetchSetupStatus(): Promise<SetupStatus> {
	try {
		const res = await fetch(`${internalApiUrl()}/api/setup/status`, { cache: 'no-store', signal: AbortSignal.timeout(API_TIMEOUT_MS) });
		if (!res.ok) return ASSUME_SET_UP;
		const data = (await res.json()) as { initialized?: unknown; registryConfigured?: unknown };
		return { initialized: data.initialized === true, registryConfigured: data.registryConfigured === true };
	} catch {
		return ASSUME_SET_UP;
	}
}
