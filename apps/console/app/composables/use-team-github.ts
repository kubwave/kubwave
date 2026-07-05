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

// Backend binds only if the signed-in user matches the grant, so a phished victim can't bind their install to someone else's team.
export function useClaimGitInstallation(teamId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (grant: string) => apiData(api.teams(toValue(teamId) as string).git.installations.claim.post({ grant })),
		onSuccess: () => {
			const id = toValue(teamId);
			if (id) {
				queryClient.invalidateQueries({ queryKey: queryKeys.gitInstallations(id) });
				queryClient.invalidateQueries({ queryKey: queryKeys.gitConnection(id) });
			}
			toast.success('Repository access installed');
		},
		onError: () => toast.error('Could not finish installing repository access')
	});
}
