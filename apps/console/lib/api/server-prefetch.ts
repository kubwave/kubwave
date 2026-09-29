import { apiResult } from '@kubwave/api-client';
import { dehydrate, QueryClient, type DehydratedState, type QueryKey } from '@tanstack/react-query';
import type { ApiClient } from './browser-api';
import { getServerApi } from './server-api';

type Seed = <T>(queryKey: QueryKey, request: (api: ApiClient) => Promise<{ data: T | null } | unknown>) => Promise<T | null>;

// Seeds the React Query cache during a full page load so the first render has data. Keys must match
// the client hooks exactly. Without a token (client navigation) nothing is seeded and the browser fetches.
export async function serverPrefetch(load: (seed: Seed) => Promise<void>): Promise<DehydratedState | null> {
	const api = await getServerApi();
	if (!api) return null;
	const queryClient = new QueryClient();
	const seed: Seed = async (queryKey, request) => {
		const { data } = await apiResult(request(api) as Promise<unknown>);
		if (data !== null) queryClient.setQueryData(queryKey, data);
		return data as never;
	};
	await load(seed);
	return dehydrate(queryClient);
}
