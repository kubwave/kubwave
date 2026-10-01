'use client';

import { apiData, type BuildSettingsDto } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { buildGroup } from './build-model';
import { useSettingsGroup } from './use-settings-group';

export function useBuildSettings() {
	const client = useQueryClient();
	const query = useQuery({ queryKey: queryKeys.buildSettings, queryFn: () => apiData(getBrowserApi().platform.settings.builds.get()) });
	const mutation = useMutation({
		mutationFn: (body: BuildSettingsDto) => apiData(getBrowserApi().platform.settings.builds.put(body)),
		onSuccess: data => {
			client.setQueryData(queryKeys.buildSettings, data);
			toast.success('Build settings saved', { description: 'New build jobs use these settings.' });
		},
		onError: () => toast.error('Could not save build settings')
	});
	return useSettingsGroup(buildGroup, query, mutation.mutateAsync);
}
