import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export function teamGitConnectionQuery(api: ApiClient, teamId: MaybeRefOrGetter<string | null>) {
	return {
		queryKey: computed(() => queryKeys.gitConnection(toValue(teamId) ?? 'none')),
		queryFn: () => apiData(api.teams(toValue(teamId) as string).git.connection.get()),
		enabled: computed(() => Boolean(toValue(teamId)))
	};
}

export function useTeamGitConnection(teamId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	return useQuery(teamGitConnectionQuery(api, teamId));
}

export function useBindGitInstallation(teamId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (githubInstallationId: string) => apiData(api.teams(toValue(teamId) as string).git.installations.post({ githubInstallationId })),
		onSuccess: () => {
			const id = toValue(teamId);
			if (id) {
				queryClient.invalidateQueries({ queryKey: queryKeys.gitInstallations(id) });
				queryClient.invalidateQueries({ queryKey: queryKeys.gitConnection(id) });
			}
			toast.success('Repository access installed');
		},
		onError: () => toast.error('Could not link the installation to your team')
	});
}
