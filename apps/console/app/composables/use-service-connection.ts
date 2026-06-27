import { useQuery } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';

// Managed-database connection details (incl. the generated password) come from a dedicated
// endpoint, never the normal service payload. Loaded lazily by the Source > Database section.
export function useServiceConnection(serviceId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();

	return useQuery({
		queryKey: computed(() => queryKeys.serviceConnection(toValue(serviceId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(serviceId))),
		queryFn: () =>
			apiData(api.services(toValue(serviceId)!).connection.get()).catch(() => {
				throw new Error('Failed to load connection details');
			})
	});
}
