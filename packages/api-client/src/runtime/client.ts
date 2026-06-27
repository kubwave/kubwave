import { createClient, type Client } from '../generated/client/index.js';
import { createResourceClient, type KubwaveRawClient, type KubwaveResourceClient } from '../generated/resource-client.gen.js';
import * as sdk from '../generated/sdk.gen.js';
export { apiData, apiResult, normalizeApiError } from './result.js';
export type { ApiData, ApiResult, KubwaveApiErrorBody, KubwaveApiResult, NormalizeApiData } from './result.js';

export interface KubwaveClientOptions {
	baseUrl: string;
	getAccessToken?: () => string | null | undefined;
	refreshAccessToken?: () => Promise<string | null | undefined>;
	headers?: HeadersInit;
}

export type KubwaveFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface KubwaveClientConfig {
	baseUrl: string;
	fetch: KubwaveFetch;
	headers?: HeadersInit;
}

export type KubwaveSdkClient = KubwaveResourceClient;

export function createKubwaveClient(options: KubwaveClientOptions): KubwaveClientConfig {
	return {
		baseUrl: options.baseUrl.replace(/\/$/, ''),
		headers: options.headers,
		fetch: createKubwaveFetch(options)
	};
}

export function createKubwaveSdkClient(options: KubwaveClientOptions): KubwaveSdkClient {
	const config = createKubwaveClient(options);
	const client = createClient({
		...config,
		fetch: config.fetch as typeof fetch,
		responseStyle: 'fields',
		throwOnError: false
	});

	return createResourceClient(createBoundSdkClient(client));
}

export function createBoundSdkClient(client: Client): KubwaveRawClient {
	return new Proxy(
		{},
		{
			get(_target, property) {
				const operation = (sdk as Record<PropertyKey, unknown>)[property];
				if (typeof operation !== 'function') return undefined;
				return (options?: Record<string, unknown>) => operation({ ...options, client });
			}
		}
	) as KubwaveRawClient;
}

export function createKubwaveFetch(options: KubwaveClientOptions): KubwaveFetch {
	return async (input, init) => {
		const withAuth = (token: string | null | undefined): RequestInit => {
			// Seed from the incoming Request's headers first: re-issuing fetch with our own `headers` replaces its list wholesale, dropping the baked-in Content-Type.
			const headers = new Headers(input instanceof Request ? input.headers : undefined);
			for (const [key, value] of new Headers(options.headers)) headers.set(key, value);
			if (init?.headers) {
				for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
			}
			if (token) headers.set('Authorization', `Bearer ${token}`);
			return { ...init, headers, credentials: init?.credentials ?? 'include' };
		};

		const response = await fetch(input, withAuth(options.getAccessToken?.()));
		if (response.status !== 401 || !options.refreshAccessToken) return response;

		const refreshed = await options.refreshAccessToken();
		if (!refreshed) return response;
		return fetch(input, withAuth(refreshed));
	};
}
