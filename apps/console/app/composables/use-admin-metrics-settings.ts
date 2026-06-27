import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsMetricsUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveMetricsSettingsInput = PlatformSettingsMetricsUpdateData['body'];

export async function fetchMetricsSettings(api: ApiClient) {
	return apiData(api.platform.settings.metrics.get());
}

export function metricsSettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.metricsSettings,
		queryFn: () => fetchMetricsSettings(api)
	};
}

export function useMetricsSettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings } = useQuery(metricsSettingsQuery(api));

	const save = useMutation({
		mutationFn: async (json: SaveMetricsSettingsInput) => {
			return apiData(api.platform.settings.metrics.put(json)).catch(() => {
				throw new Error('save_failed');
			});
		},
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.metricsSettings, updated);
			toast.success('Metrics settings saved');
		},
		onError: () => toast.error('Could not save settings', 'Check the values and try again.')
	});

	return { settings, save };
}
