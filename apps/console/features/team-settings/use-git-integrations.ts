'use client';

import { apiData } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';

const git = (teamId: string) => getBrowserApi().teams(teamId).git;

export function useGithubIntegration(teamId: string) {
	const connection = useQuery({
		queryKey: queryKeys.gitConnection(teamId),
		queryFn: () => apiData(git(teamId).connection.get())
	});
	const installations = useQuery({
		queryKey: queryKeys.gitInstallations(teamId),
		queryFn: () => apiData(git(teamId).installations.get())
	});
	return { connection, installations };
}

export function useGiteaIntegration(teamId: string) {
	const queryClient = useQueryClient();
	const connection = useQuery({
		queryKey: queryKeys.giteaTeamConnection(teamId),
		queryFn: () => apiData(git(teamId).gitea.connection.get())
	});
	const accounts = useQuery({
		queryKey: queryKeys.giteaInstallations(teamId),
		queryFn: () => apiData(git(teamId).gitea.installations.get())
	});
	const unbind = useMutation({
		mutationFn: (accountId: string) => apiData(git(teamId).gitea.installations(accountId).delete()),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.giteaInstallations(teamId) })
	});
	return { connection, accounts, unbind };
}
