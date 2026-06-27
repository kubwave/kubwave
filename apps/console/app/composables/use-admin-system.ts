import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformUpdatesGetResponse, PlatformVersionGetResponse } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type VersionInfo = PlatformVersionGetResponse;
export type UpdateRun = PlatformUpdatesGetResponse;

const TERMINAL_UPDATE_STATUSES = new Set(['succeeded', 'failed', 'rolled_back']);

export function isTerminalUpdateStatus(status: string | undefined): boolean {
	return status != null && TERMINAL_UPDATE_STATUSES.has(status);
}

export async function fetchVersionInfo(api: ApiClient) {
	return apiData(api.platform.version.get());
}

export function versionInfoQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.version,
		queryFn: () => fetchVersionInfo(api)
	};
}

export async function fetchPlatformHealth(api: ApiClient) {
	return apiData(api.health.get({ verbose: 'true' }));
}

export function platformHealthQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.health,
		queryFn: () => fetchPlatformHealth(api)
	};
}

export async function fetchUpdateRuns(api: ApiClient) {
	return apiData(api.platform.updates.get());
}

export function updateRunsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.updates,
		queryFn: () => fetchUpdateRuns(api)
	};
}

export function useAdminSystemStatus() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: versionInfo } = useQuery(versionInfoQuery(api));
	const { data: health } = useQuery(platformHealthQuery(api));
	const { data: updateRuns } = useQuery(updateRunsQuery(api));

	const check = useMutation({
		mutationFn: async () => {
			return apiData(api.platform.version.check.post()).catch(() => {
				throw new Error('check_failed');
			});
		},
		onSuccess: async result => {
			await queryClient.invalidateQueries({ queryKey: queryKeys.version });
			if (result.success) {
				toast.success('Checked for updates', result.message);
			} else {
				toast.warning('Update check failed', result.message);
			}
		},
		onError: () => toast.error('Could not check for updates')
	});

	const trigger = useMutation({
		mutationFn: async (targetVersion: string) => {
			return apiData(api.platform.updates.post({ targetVersion })).catch(err => {
				const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status?: unknown }).status) : undefined;
				throw new Error(status === 409 ? 'An update is already in progress.' : 'Could not start the update.');
			});
		},
		onSuccess: run => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.updates });
			return run;
		},
		onError: (err: Error) => toast.error('Update failed to start', err.message)
	});

	function invalidateSystemState() {
		void queryClient.invalidateQueries({ queryKey: queryKeys.version });
		void queryClient.invalidateQueries({ queryKey: queryKeys.updates });
	}

	return { versionInfo, health, updateRuns, check, trigger, invalidateSystemState };
}

export async function fetchUpdateRun(api: ApiClient, runId: string) {
	return apiData(api.platform.updates(runId).get()).catch(() => {
		throw new Error('Failed to load update run');
	});
}

export async function fetchUpdateRunLogs(api: ApiClient, runId: string) {
	return apiData(api.platform.updates(runId).logs.get()).catch(() => {
		throw new Error('Could not load logs.');
	});
}

export function useUpdateRunProgress(runId: MaybeRefOrGetter<string | null | undefined>, open: MaybeRefOrGetter<boolean>) {
	const api = useApi();

	const enabled = computed(() => toValue(open) && Boolean(toValue(runId)));

	const { data: run } = useQuery({
		queryKey: computed(() => queryKeys.updateRun(toValue(runId) ?? 'none')),
		enabled,
		queryFn: () => fetchUpdateRun(api, toValue(runId)!),
		refetchInterval: query => (isTerminalUpdateStatus(query.state.data?.status) ? false : 2000)
	});

	const { data: logsData, error: logsError } = useQuery({
		queryKey: computed(() => queryKeys.updateRunLogs(toValue(runId) ?? 'none')),
		enabled,
		queryFn: () => fetchUpdateRunLogs(api, toValue(runId)!),
		refetchInterval: () => (isTerminalUpdateStatus(run.value?.status) ? false : 2000)
	});

	const finished = computed(() => isTerminalUpdateStatus(run.value?.status));
	const succeeded = computed(() => run.value?.status === 'succeeded');
	const isFailed = computed(() => run.value?.status === 'failed' || run.value?.status === 'rolled_back');
	const logs = computed(() => logsData.value?.logs ?? (logsError.value ? 'Could not load logs.' : ''));

	return { run, logsData, logsError, finished, succeeded, isFailed, logs };
}
