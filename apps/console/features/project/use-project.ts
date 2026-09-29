'use client';

import { apiData, type TeamProjectsListResponse } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';

export type ProjectListItem = TeamProjectsListResponse[number];

export const projectQuery = (projectId: string) => ({
	queryKey: queryKeys.project(projectId),
	queryFn: () => apiData(getBrowserApi().projects(projectId).get())
});

export const teamProjectsQuery = (teamId: string) => ({
	queryKey: queryKeys.teamProjects(teamId),
	queryFn: () => apiData(getBrowserApi().teams(teamId).projects.get())
});

// Polled: preview environments are created and torn down by the worker, with no mutation to invalidate on.
export function useProject(projectId: string | undefined) {
	return useQuery({ ...projectQuery(projectId ?? 'none'), enabled: Boolean(projectId), refetchInterval: 10_000 });
}

export function useTeamProjects(teamId: string | null) {
	return useQuery({ ...teamProjectsQuery(teamId ?? 'none'), enabled: Boolean(teamId) });
}

export function useCreateProject(teamId: string | null) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { name: string; description?: string }) => apiData(getBrowserApi().teams(teamId!).projects.post(input)),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.teamProjects(teamId ?? 'none') })
	});
}

// Project and environment edits refresh the project (tabs, switchers) and the team's project list.
function useProjectMutation<TInput, TResult>(projectId: string, teamId: string, mutationFn: (input: TInput) => Promise<TResult>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.teamProjects(teamId) });
		}
	});
}

export function useUpdateProject(project: { id: string; teamId: string }) {
	return useProjectMutation(project.id, project.teamId, (input: { name: string; description: string }) =>
		apiData(getBrowserApi().projects(project.id).patch(input))
	);
}

export function useDeleteProject(project: { id: string; teamId: string }) {
	return useProjectMutation(project.id, project.teamId, () => apiData(getBrowserApi().projects(project.id).delete()));
}

export function useSetPrPreviews(project: { id: string; teamId: string }) {
	return useProjectMutation(project.id, project.teamId, (baseEnvironmentId: string | null) =>
		apiData(getBrowserApi().projects(project.id).prPreviews.patch({ baseEnvironmentId }))
	);
}

export function useCreateEnvironment(project: { id: string; teamId: string }) {
	return useProjectMutation(project.id, project.teamId, (name: string) =>
		apiData(getBrowserApi().projects(project.id).environments.post({ name: name.trim() }))
	);
}

export function useRenameEnvironment(project: { id: string; teamId: string }) {
	return useProjectMutation(project.id, project.teamId, (input: { environmentId: string; name: string }) =>
		apiData(getBrowserApi().environments(input.environmentId).patch({ name: input.name.trim() }))
	);
}

export function useDeleteEnvironment(project: { id: string; teamId: string }) {
	return useProjectMutation(project.id, project.teamId, (environmentId: string) => apiData(getBrowserApi().environments(environmentId).delete()));
}
