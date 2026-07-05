import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';

export function useGitInstallations(teamId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	return useQuery({
		queryKey: computed(() => queryKeys.gitInstallations(toValue(teamId) ?? 'none')),
		queryFn: () => apiData(api.teams(toValue(teamId) as string).git.installations.get()),
		enabled: computed(() => Boolean(toValue(teamId)))
	});
}

export function useGitRepos(teamId: MaybeRefOrGetter<string | null>, installationId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	return useQuery({
		queryKey: computed(() => queryKeys.gitRepos(toValue(teamId) ?? 'none', toValue(installationId) ?? 'none')),
		queryFn: () =>
			apiData(
				api
					.teams(toValue(teamId) as string)
					.git.installations(toValue(installationId) as string)
					.repos.get()
			),
		enabled: computed(() => Boolean(toValue(teamId)) && Boolean(toValue(installationId)))
	});
}

export function useSyncGitRepos(teamId: MaybeRefOrGetter<string | null>, installationId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () =>
			apiData(
				api
					.teams(toValue(teamId) as string)
					.git.installations(toValue(installationId) as string)
					.repos.sync.post()
			),
		onSuccess: repos => {
			queryClient.setQueryData(queryKeys.gitRepos(toValue(teamId) ?? 'none', toValue(installationId) ?? 'none'), repos);
		}
	});
}
