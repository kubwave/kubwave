'use client';

import { apiData } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { registryPollInterval, type RegistryPayload } from './registry-model';

export function useRegistrySettings({ enabled = true }: { enabled?: boolean } = {}) {
	const queryClient = useQueryClient();
	const settings = useQuery({
		queryKey: queryKeys.registrySettings,
		queryFn: () => apiData(getBrowserApi().platform.settings.registry.get()),
		refetchInterval: query => registryPollInterval(query.state.data),
		enabled
	});
	const save = useMutation({
		mutationFn: (payload: RegistryPayload) => apiData(getBrowserApi().platform.settings.registry.put(payload)),
		onSuccess: updated => queryClient.setQueryData(queryKeys.registrySettings, updated)
	});
	return { settings, save };
}
