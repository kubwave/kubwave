import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';
import type { ProjectDetail } from '~/utils/types';

// Project-level mutations used by the settings modal: rename/describe, PR-preview base, delete.

export function useUpdateProject(project: MaybeRefOrGetter<ProjectDetail>) {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: { name: string; description: string }): Promise<ProjectDetail> => apiData(api.projects(toValue(project).id).patch(input)),
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.project(updated.id), updated);
			void queryClient.invalidateQueries({ queryKey: queryKeys.teamProjects(toValue(project).teamId) });
		}
	});
}

export function useUpdateProjectPrPreviews(project: MaybeRefOrGetter<ProjectDetail>) {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (baseEnvironmentId: string | null): Promise<ProjectDetail> =>
			apiData(api.projects(toValue(project).id).prPreviews.patch({ baseEnvironmentId })),
		onSuccess: updated => queryClient.setQueryData(queryKeys.project(updated.id), updated)
	});
}

export function useDeleteProject(project: MaybeRefOrGetter<ProjectDetail>) {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: () => apiData(api.projects(toValue(project).id).delete()),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.teamProjects(toValue(project).teamId) })
	});
}
