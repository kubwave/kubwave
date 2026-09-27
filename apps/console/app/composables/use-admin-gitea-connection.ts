import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export function giteaConnectionQuery(api: ApiClient) {
	return { queryKey: queryKeys.giteaConnection, queryFn: () => apiData(api.git.gitea.get()) };
}

export function useGiteaConnection() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: connection, refetch } = useQuery(giteaConnectionQuery(api));

	const connect = useMutation({
		mutationFn: (body: { instanceUrl: string; clientId: string; clientSecret: string }) => apiData(api.git.gitea.post(body)),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.giteaConnection });
			toast.success('Gitea connected', 'Teams can now authorize access in team settings.');
		},
		onError: (err: unknown) => {
			const body = err as { status?: number; error?: string; details?: unknown };
			const detail = typeof body.details === 'string' ? body.details : null;
			if (body.error === 'gitea_unreachable') {
				toast.error('Could not reach Gitea', detail ?? 'Use an instance URL the API can reach from the cluster.');
				return;
			}
			toast.error(
				'Could not connect Gitea',
				detail ? `${body.error ?? 'error'}: ${detail}` : (body.error ?? 'Check the instance URL and OAuth credentials.')
			);
		}
	});

	const disconnect = useMutation({
		mutationFn: () => apiData(api.git.gitea.delete()),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.giteaConnection });
			toast.success('Gitea disconnected');
		},
		onError: () => toast.error('Could not disconnect Gitea')
	});

	return { connection, refetch, connect, disconnect };
}
