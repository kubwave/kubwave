import { getCookie } from 'h3';
import { createKubwaveSdkClient } from '@kubwave/api-client';
import { createBrowserApiClient, type ApiClient } from '~/utils/api-client';

// Client-side singleton (Bearer + 401-retry).
let browserClient: ApiClient | null = null;

// SSR: absolute INTERNAL_API_URL base, Bearer + forwarded active_team cookie. Browser: same-origin with in-memory token.
export function useApi(): ApiClient {
	if (import.meta.server) {
		const event = useRequestEvent();
		const accessToken = event?.context.accessToken;
		// getCookie (h3) is only reached in this server branch, so h3 never ships to the browser bundle.
		const activeTeam = event ? getCookie(event, 'active_team') : undefined;
		const headers: Record<string, string> = {};
		if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
		if (activeTeam) headers.cookie = `active_team=${activeTeam}`;
		// Duplicated from server/utils/config.ts (not auto-imported into app/); keep both in sync.
		const base = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';
		return createKubwaveSdkClient({ baseUrl: base, headers });
	}
	browserClient ??= createBrowserApiClient();
	return browserClient;
}
