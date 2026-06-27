import { createKubwaveSdkClient, type KubwaveSdkClient } from '@kubwave/api-client';
import { getAccessToken, refreshAccessToken } from '~/utils/token-store';

export { apiData, apiResult } from '@kubwave/api-client';
export type ApiClient = KubwaveSdkClient;

// Browser instance: relative base (same-origin /api), Bearer token + 401-refresh-once-and-retry.
export function createBrowserApiClient(): ApiClient {
	return createKubwaveSdkClient({
		baseUrl: '',
		getAccessToken,
		refreshAccessToken
	});
}
