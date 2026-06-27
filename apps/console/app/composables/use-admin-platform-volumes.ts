import { useQuery } from '@tanstack/vue-query';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export async function fetchPlatformVolumes(api: ApiClient) {
	return apiData(api.platform.settings.platformVolumes.get());
}

export function platformVolumesQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.platformVolumes,
		queryFn: () => fetchPlatformVolumes(api)
	};
}

// Live fill of the platform-managed PVCs; slow polling since they grow over hours/days, not seconds.
export function usePlatformVolumes() {
	const api = useApi();
	const { data: volumes, isLoading } = useQuery({
		...platformVolumesQuery(api),
		refetchInterval: 30_000,
		refetchOnWindowFocus: true
	});
	return { volumes, isLoading };
}
