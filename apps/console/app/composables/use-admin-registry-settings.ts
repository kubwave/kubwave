import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsRegistryUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveRegistryInput = PlatformSettingsRegistryUpdateData['body'];

async function fetchRegistry(api: ApiClient) {
	return apiData(api.platform.settings.registry.get());
}

export function registrySettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.registrySettings,
		queryFn: () => fetchRegistry(api),
		// Poll while the platform applies the registry; stop once it settles.
		refetchInterval: (query: { state: { data?: Awaited<ReturnType<typeof fetchRegistry>> } }) => {
			const status = query.state.data?.applyStatus;
			return status === 'pending' || status === 'applying' ? 3000 : false;
		}
	};
}

export function useRegistrySettings(options: { enabled?: MaybeRefOrGetter<boolean> } = {}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings, refetch } = useQuery({ ...registrySettingsQuery(api), enabled: options.enabled ?? true });

	const save = useMutation({
		mutationFn: (json: SaveRegistryInput) => apiData(api.platform.settings.registry.put(json)),
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.registrySettings, updated);
			toast.success('Registry settings saved');
		},
		onError: () => toast.error('Could not save registry settings', 'Check the values and try again.')
	});

	return { settings, save, refetch };
}
