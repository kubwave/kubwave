import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsDeploymentConcurrencyUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveDeploymentConcurrencyInput = PlatformSettingsDeploymentConcurrencyUpdateData['body'];

export async function fetchDeploymentConcurrencySettings(api: ApiClient) {
	return apiData(api.platform.settings.deploymentConcurrency.get());
}

export function deploymentConcurrencySettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.deploymentConcurrency,
		queryFn: () => fetchDeploymentConcurrencySettings(api)
	};
}

export function useDeploymentConcurrencySettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings } = useQuery(deploymentConcurrencySettingsQuery(api));

	const save = useMutation({
		mutationFn: async (json: SaveDeploymentConcurrencyInput) => {
			return apiData(api.platform.settings.deploymentConcurrency.put(json)).catch(() => {
				throw new Error('save_failed');
			});
		},
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.deploymentConcurrency, updated);
			toast.success('Deployment concurrency saved', `Up to ${updated.maxConcurrentDeployments} deployment(s) will run at the same time.`);
		},
		onError: () => toast.error('Could not save settings', 'Try again in a moment.')
	});

	return { settings, save };
}
