import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsPrPreviewsUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SavePrPreviewInput = PlatformSettingsPrPreviewsUpdateData['body'];

export async function fetchPrPreviewSettings(api: ApiClient) {
	return apiData(api.platform.settings.prPreviews.get());
}

export function prPreviewSettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.prPreviews,
		queryFn: () => fetchPrPreviewSettings(api)
	};
}

export function usePrPreviewSettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings } = useQuery(prPreviewSettingsQuery(api));

	const save = useMutation({
		mutationFn: async (json: SavePrPreviewInput) => {
			return apiData(api.platform.settings.prPreviews.put(json)).catch(() => {
				throw new Error('save_failed');
			});
		},
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.prPreviews, updated);
			toast.success(
				'PR preview limit saved',
				updated.maxPreviewsPerProject === 0
					? 'Preview environment creation is paused.'
					: `Up to ${updated.maxPreviewsPerProject} preview environment(s) per project.`
			);
		},
		onError: () => toast.error('Could not save settings', 'Try again in a moment.')
	});

	return { settings, save };
}
