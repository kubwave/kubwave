import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';
import type { Environment } from '~/utils/types';

// Create / rename / delete environments. Each invalidates queryKeys.project so the env tab strip and canvas refresh.

export function useSaveEnvironment(projectId: MaybeRefOrGetter<string>) {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { name: string; environmentId?: string | null }): Promise<Environment> => {
			const result = input.environmentId
				? api.environments(input.environmentId).patch({ name: input.name })
				: api.projects(toValue(projectId)).environments.post({ name: input.name });
			return apiData(result);
		},
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.project(toValue(projectId)) })
	});
}

export function useDeleteEnvironment(projectId: MaybeRefOrGetter<string>) {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (environmentId: string) => apiData(api.environments(environmentId).delete()),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.project(toValue(projectId)) })
	});
}
