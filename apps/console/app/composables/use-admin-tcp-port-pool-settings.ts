import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsTcpPortPoolUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveTcpPortPoolSettingsInput = PlatformSettingsTcpPortPoolUpdateData['body'];

export async function fetchTcpPortPoolSettings(api: ApiClient) {
	return apiData(api.platform.settings.tcpPortPool.get());
}

export function tcpPortPoolSettingsQuery(api: ApiClient) {
	return { queryKey: queryKeys.tcpPortPoolSettings, queryFn: () => fetchTcpPortPoolSettings(api) };
}

export function useTcpPortPoolSettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();
	const { data: settings } = useQuery(tcpPortPoolSettingsQuery(api));

	const save = useMutation({
		mutationFn: (json: SaveTcpPortPoolSettingsInput) => apiData(api.platform.settings.tcpPortPool.put(json)),
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.tcpPortPoolSettings, {
				enabled: updated.enabled,
				start: updated.start,
				size: updated.size
			});
			queryClient.invalidateQueries({ queryKey: queryKeys.updates });
			toast.success('TCP port pool update started', 'Traefik, the load balancer, API, and worker are reconciling now.');
		},
		onError: () => toast.error('Could not update TCP port pool', 'Remove exposures outside the selected pool, then try again.')
	});

	return { settings, save };
}
