import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsDomainUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveDefaultDomainInput = PlatformSettingsDomainUpdateData['body'];

export async function fetchDefaultDomainSettings(api: ApiClient) {
	return apiData(api.platform.settings.domain.get());
}

export function defaultDomainSettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.defaultDomain,
		queryFn: () => fetchDefaultDomainSettings(api)
	};
}

export function useDefaultDomainSettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings } = useQuery(defaultDomainSettingsQuery(api));

	const save = useMutation({
		mutationFn: async (json: SaveDefaultDomainInput) => {
			return apiData(api.platform.settings.domain.put(json)).catch(() => {
				throw new Error('save_failed');
			});
		},
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.defaultDomain, updated);
			void queryClient.invalidateQueries({ queryKey: queryKeys.services });
			void queryClient.invalidateQueries({ queryKey: queryKeys.environments });
			toast.success('Domain settings saved');
		},
		onError: () => toast.error('Could not save settings', 'Check the values and try again.')
	});

	return { settings, save };
}
