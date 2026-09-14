import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';

export function useGiteaInstallations(teamId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	return useQuery({
		queryKey: computed(() => queryKeys.giteaInstallations(toValue(teamId) ?? 'none')),
		queryFn: () => apiData(api.teams(toValue(teamId) as string).git.gitea.installations.get()),
		enabled: computed(() => Boolean(toValue(teamId)))
	});
}

export function useGiteaRepos(teamId: MaybeRefOrGetter<string | null>, installationId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	return useQuery({
		queryKey: computed(() => queryKeys.giteaRepos(toValue(teamId) ?? 'none', toValue(installationId) ?? 'none')),
		queryFn: () =>
			apiData(
				api
					.teams(toValue(teamId) as string)
					.git.gitea.installations(toValue(installationId) as string)
					.repos.get()
			),
		enabled: computed(() => Boolean(toValue(teamId)) && Boolean(toValue(installationId)))
	});
}

export function useSyncGiteaRepos(teamId: MaybeRefOrGetter<string | null>, installationId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () =>
			apiData(
				api
					.teams(toValue(teamId) as string)
					.git.gitea.installations(toValue(installationId) as string)
					.repos.sync.post()
			),
		onSuccess: repos => {
			queryClient.setQueryData(queryKeys.giteaRepos(toValue(teamId) ?? 'none', toValue(installationId) ?? 'none'), repos);
		}
	});
}
