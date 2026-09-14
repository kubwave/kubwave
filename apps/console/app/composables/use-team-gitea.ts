import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export function teamGiteaConnectionQuery(api: ApiClient, teamId: MaybeRefOrGetter<string | null>) {
	return {
		queryKey: computed(() => queryKeys.giteaTeamConnection(toValue(teamId) ?? 'none')),
		queryFn: () => apiData(api.teams(toValue(teamId) as string).git.gitea.connection.get()),
		enabled: computed(() => Boolean(toValue(teamId)))
	};
}

export function useTeamGiteaConnection(teamId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	return useQuery(teamGiteaConnectionQuery(api, teamId));
}

export function useClaimGiteaAccount(teamId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (grant: string) => apiData(api.teams(toValue(teamId) as string).git.gitea.installations.claim.post({ grant })),
		onSuccess: () => {
			const id = toValue(teamId);
			if (id) {
				queryClient.invalidateQueries({ queryKey: queryKeys.giteaInstallations(id) });
				queryClient.invalidateQueries({ queryKey: queryKeys.giteaTeamConnection(id) });
			}
			toast.success('Gitea account connected');
		},
		onError: () => toast.error('Could not finish connecting Gitea')
	});
}

export function useUnbindGiteaAccount(teamId: MaybeRefOrGetter<string | null>) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (installationId: string) =>
			apiData(
				api
					.teams(toValue(teamId) as string)
					.git.gitea.installations(installationId)
					.delete()
			),
		onSuccess: () => {
			const id = toValue(teamId);
			if (id) queryClient.invalidateQueries({ queryKey: queryKeys.giteaInstallations(id) });
			toast.success('Gitea account disconnected');
		},
		onError: () => toast.error('Could not disconnect Gitea account')
	});
}
