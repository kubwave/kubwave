import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { TeamProjectsListResponse } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';
import type { ProjectDetail } from '~/utils/types';

export type ProjectListItem = TeamProjectsListResponse[number];

export async function fetchTeamProjects(api: ApiClient, teamId: string) {
	return apiData(api.teams(teamId).projects.get());
}

export function teamProjectsQuery(api: ApiClient, teamId: string) {
	return {
		queryKey: queryKeys.teamProjects(teamId),
		queryFn: () => fetchTeamProjects(api, teamId)
	};
}

export function useTeamProjects(teamId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();
	return useQuery({
		queryKey: computed(() => queryKeys.teamProjects(toValue(teamId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(teamId))),
		queryFn: () => fetchTeamProjects(api, toValue(teamId)!)
	});
}

export function useCreateProject(teamId: MaybeRefOrGetter<string>) {
	const api = useApi();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { name: string; description?: string }) => apiData(api.teams(toValue(teamId)).projects.post(input)),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.teamProjects(toValue(teamId)) })
	});
}

export async function fetchProject(api: ApiClient, projectId: string) {
	return apiData(api.projects(projectId).get()).catch(() => {
		throw new Error('project_not_found');
	});
}

export function projectQuery(api: ApiClient, projectId: string) {
	return {
		queryKey: queryKeys.project(projectId),
		queryFn: () => fetchProject(api, projectId)
	};
}

export function useProjectDetail(
	projectId: MaybeRefOrGetter<string | null | undefined>,
	options: { initialData?: () => ProjectDetail | undefined; retry?: boolean } = {}
) {
	const api = useApi();
	const queryClient = useQueryClient();

	return useQuery({
		queryKey: computed(() => queryKeys.project(toValue(projectId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(projectId))),
		queryFn: () => fetchProject(api, toValue(projectId)!),
		initialData:
			options.initialData ??
			(() => {
				const id = toValue(projectId);
				return id ? queryClient.getQueryData<ProjectDetail>(queryKeys.project(id)) : undefined;
			}),
		retry: options.retry,
		// Poll because preview environments are created/torn down out-of-band by the worker, with no console mutation to invalidate on.
		refetchInterval: 10_000
	});
}

export async function fetchEnvironmentServices(api: ApiClient, environmentId: string) {
	return apiData(api.environments(environmentId).services.get()).catch(() => {
		throw new Error('failed');
	});
}

export function environmentServicesQuery(api: ApiClient, environmentId: string) {
	return {
		queryKey: queryKeys.environmentServices(environmentId),
		queryFn: () => fetchEnvironmentServices(api, environmentId)
	};
}

export function useEnvironmentServices(environmentId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();
	return useQuery({
		queryKey: computed(() => queryKeys.environmentServices(toValue(environmentId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(environmentId))),
		queryFn: () => fetchEnvironmentServices(api, toValue(environmentId)!)
	});
}
