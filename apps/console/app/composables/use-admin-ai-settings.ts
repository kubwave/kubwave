import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsAiUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveAiSettingsInput = PlatformSettingsAiUpdateData['body'];

export function aiSettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.aiSettings,
		queryFn: () => apiData(api.platform.settings.ai.get())
	};
}

export function useAiSettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings } = useQuery(aiSettingsQuery(api));

	const save = useMutation({
		mutationFn: async (json: SaveAiSettingsInput) => {
			return apiData(api.platform.settings.ai.put(json)).catch(() => {
				throw new Error('save_failed');
			});
		},
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.aiSettings, updated);
			void queryClient.invalidateQueries({ queryKey: queryKeys.aiStatus });
			toast.success('AI settings saved');
		},
		onError: () => toast.error('Could not save settings', 'Check the values and try again.')
	});

	return { settings, save };
}
