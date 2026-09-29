import { createKubwaveSdkClient } from '@kubwave/api-client';
import { cookies, headers } from 'next/headers';
import { ACCESS_TOKEN_HEADER } from '@/lib/auth/request-token';
import { internalApiUrl } from '@/lib/server-config';
import type { ApiClient } from './browser-api';

// Server rendering talks to the API directly. Only full page loads carry a token (see proxy.ts);
// client navigations render without one and the browser fetches the data instead.
export async function getServerApi(): Promise<ApiClient | null> {
	const accessToken = (await headers()).get(ACCESS_TOKEN_HEADER);
	if (!accessToken) return null;
	const activeTeam = (await cookies()).get('active_team')?.value;
	return createKubwaveSdkClient({
		baseUrl: internalApiUrl(),
		headers: { Authorization: `Bearer ${accessToken}`, ...(activeTeam ? { cookie: `active_team=${activeTeam}` } : {}) }
	});
}
