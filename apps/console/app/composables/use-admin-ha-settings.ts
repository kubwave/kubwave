import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsHaUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveHaSettingsInput = PlatformSettingsHaUpdateData['body'];

export async function fetchHaSettings(api: ApiClient) {
	return apiData(api.platform.settings.ha.get());
}

export function haSettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.haSettings,
		queryFn: () => fetchHaSettings(api)
	};
}

export function useHaSettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings } = useQuery(haSettingsQuery(api));

	const save = useMutation({
		mutationFn: async (json: SaveHaSettingsInput) => {
			return apiData(api.platform.settings.ha.put(json)).catch(() => {
				throw new Error('save_failed');
			});
		},
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.haSettings, updated);
			toast.success(
				updated.enabled ? 'High availability enabled' : 'High availability disabled',
				'The worker is rolling the control plane to match — this takes a moment.'
			);
		},
		onError: () => toast.error('Could not save settings', 'Try again in a moment.')
	});

	return { settings, save };
}
