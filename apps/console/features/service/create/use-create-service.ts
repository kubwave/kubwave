'use client';

import { apiData, type CreateServiceDto, type GitRepositoryDto } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';

export const environmentApi = (environmentId: string) => getBrowserApi().environments(environmentId).services;

// Resolves once the service list refetched, so the caller can select the new service right away;
// layout and runtime status refresh in the background.
export function useCreateMutation<TInput, TResult>(environmentId: string, mutationFn: (input: TInput) => Promise<TResult>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.environmentFlowLayout(environmentId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServiceStatus(environmentId) });
			return queryClient.invalidateQueries({ queryKey: queryKeys.environmentServices(environmentId) });
		}
	});
}

export const useCreateService = (environmentId: string) =>
	useCreateMutation(environmentId, (input: CreateServiceDto) => apiData(environmentApi(environmentId).post(input)));

export function useTemplates() {
	return useQuery({ queryKey: queryKeys.templates, queryFn: () => apiData(getBrowserApi().templates.get()) });
}

export function useAiStatus() {
	return useQuery({ queryKey: queryKeys.aiStatus, queryFn: () => apiData(getBrowserApi().ai.status.get()) });
}

export type GitProvider = 'github' | 'gitea';

// GitHub App installations and Gitea accounts share this shape.
type GitAccount = { id: string; accountLogin: string };

const gitInstallations = (provider: GitProvider, teamId: string) => {
	const git = getBrowserApi().teams(teamId).git;
	return provider === 'github' ? git.installations : git.gitea.installations;
};

// GitHub App installations or Gitea accounts of the team, and the repositories of the picked one.
export function useGitRepositories(provider: GitProvider, teamId: string | null, installationId: string) {
	const queryClient = useQueryClient();
	const team = teamId ?? 'none';
	const reposKey = provider === 'github' ? queryKeys.gitRepos(team, installationId || 'none') : queryKeys.giteaRepos(team, installationId || 'none');
	const installations = useQuery({
		queryKey: provider === 'github' ? queryKeys.gitInstallations(team) : queryKeys.giteaInstallations(team),
		queryFn: (): Promise<GitAccount[]> => apiData(gitInstallations(provider, team).get()),
		enabled: Boolean(teamId)
	});
	const repos = useQuery({
		queryKey: reposKey,
		queryFn: (): Promise<GitRepositoryDto[]> => apiData(gitInstallations(provider, team)(installationId).repos.get()),
		enabled: Boolean(teamId && installationId)
	});
	const sync = useMutation({
		mutationFn: (): Promise<GitRepositoryDto[]> => apiData(gitInstallations(provider, team)(installationId).repos.sync.post()),
		onSuccess: data => queryClient.setQueryData(reposKey, data)
	});
	return { installations, repos, sync };
}
