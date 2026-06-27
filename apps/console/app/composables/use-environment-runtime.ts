import { useQuery } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';
import type { ServiceRuntime } from '~/utils/types';

// Live runtime status per service in an environment (polled every 5s), exposed as a serviceId → runtime map.
export function useEnvironmentRuntime(environmentId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();

	const { data } = useQuery({
		queryKey: computed(() => queryKeys.environmentServiceStatus(toValue(environmentId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(environmentId))),
		refetchInterval: 5000,
		queryFn: async () => {
			const id = toValue(environmentId);
			return apiData(api.environments(id!).services.status.get()).catch(() => {
				throw new Error('Failed to load runtime status');
			});
		}
	});

	const runtimeById = computed<Record<string, ServiceRuntime>>(() => {
		const map: Record<string, ServiceRuntime> = {};
		for (const entry of data.value ?? []) map[entry.serviceId] = entry.runtime;
		return map;
	});

	return { runtimeById };
}
