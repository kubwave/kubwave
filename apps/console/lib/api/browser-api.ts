import { createKubwaveSdkClient, type KubwaveSdkClient } from '@kubwave/api-client';
import { getAccessToken, refreshAccessToken } from '@/lib/auth/token-store';

export type ApiClient = KubwaveSdkClient;

let client: ApiClient | null = null;

// Same-origin /api with the in-memory token; a 401 refreshes once and retries.
export function getBrowserApi(): ApiClient {
	client ??= createKubwaveSdkClient({ baseUrl: '', getAccessToken, refreshAccessToken });
	return client;
}
