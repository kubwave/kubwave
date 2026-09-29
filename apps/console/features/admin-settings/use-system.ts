'use client';

import { apiData } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { updateRunPollInterval } from './update-runs';

export const versionQuery = { queryKey: queryKeys.version, queryFn: () => apiData(getBrowserApi().platform.version.get()) };
export const healthQuery = { queryKey: queryKeys.health, queryFn: () => apiData(getBrowserApi().health.get({ verbose: 'true' })) };
export const updateRunsQuery = { queryKey: queryKeys.updates, queryFn: () => apiData(getBrowserApi().platform.updates.get()) };

export function useInvalidateSystem() {
	const queryClient = useQueryClient();
	return () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.version });
		void queryClient.invalidateQueries({ queryKey: queryKeys.updates });
	};
}

export function useCheckForUpdates() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => apiData(getBrowserApi().platform.version.check.post()),
		onSuccess: async result => {
			await queryClient.invalidateQueries({ queryKey: queryKeys.version });
			if (result.success) toast.success('Checked for updates', { description: result.message });
			else toast.warning('Update check failed', { description: result.message });
		},
		onError: () => toast.error('Could not check for updates')
	});
}

export function useTriggerUpdate() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (targetVersion: string) => apiData(getBrowserApi().platform.updates.post({ targetVersion })),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.updates }),
		onError: err =>
			toast.error('Update failed to start', {
				description: (err as { status?: number }).status === 409 ? 'An update is already in progress.' : 'Could not start the update.'
			})
	});
}

// Polls the run and its logs every 2s while the dialog is open, until the run is terminal.
export function useUpdateRunProgress(runId: string | null, open: boolean) {
	const id = runId ?? 'none';
	const enabled = open && runId !== null;
	const run = useQuery({
		queryKey: queryKeys.updateRun(id),
		queryFn: () => apiData(getBrowserApi().platform.updates(id).get()),
		enabled,
		refetchInterval: query => updateRunPollInterval(query.state.data?.status)
	});
	const logs = useQuery({
		queryKey: queryKeys.updateRunLogs(id),
		queryFn: () => apiData(getBrowserApi().platform.updates(id).logs.get()),
		enabled,
		refetchInterval: () => updateRunPollInterval(run.data?.status)
	});
	return { run: run.data, logs: logs.data?.logs ?? (logs.isError ? 'Could not load logs.' : '') };
}
