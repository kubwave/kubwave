import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsVolumeAutoscalingUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveVolumeAutoscalingSettingsInput = PlatformSettingsVolumeAutoscalingUpdateData['body'];

export async function fetchVolumeAutoscalingSettings(api: ApiClient) {
	return apiData(api.platform.settings.volumeAutoscaling.get());
}

export function volumeAutoscalingSettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.volumeAutoscalingSettings,
		queryFn: () => fetchVolumeAutoscalingSettings(api)
	};
}

export function useVolumeAutoscalingSettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings } = useQuery(volumeAutoscalingSettingsQuery(api));

	const save = useMutation({
		mutationFn: async (json: SaveVolumeAutoscalingSettingsInput) => {
			return apiData(api.platform.settings.volumeAutoscaling.put(json)).catch(() => {
				throw new Error('save_failed');
			});
		},
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.volumeAutoscalingSettings, updated);
			toast.success(
				updated.enabled ? 'Volume autoscaling enabled' : 'Volume autoscaling disabled',
				'The worker checks platform volume usage every few minutes.'
			);
		},
		onError: () => toast.error('Could not save settings', 'Check the values and try again.')
	});

	return { settings, save };
}
