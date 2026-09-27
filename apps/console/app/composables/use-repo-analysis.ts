import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { EnvironmentServicesAnalyzeRepositoryData, EnvironmentServicesCreateFromPlanData } from '@kubwave/api-client';
import { queryKeys } from '~/utils/query-keys';

export type RepoSourceInput = EnvironmentServicesAnalyzeRepositoryData['body']['source'];
export type CreateFromPlanInput = EnvironmentServicesCreateFromPlanData['body'];

export function useAiStatus() {
	const api = useApi();
	return useQuery({
		queryKey: queryKeys.aiStatus,
		queryFn: () => apiData(api.ai.status.get())
	});
}

export function useAnalyzeRepository(environmentId: MaybeRefOrGetter<string>) {
	const api = useApi();
	return useMutation({
		mutationFn: (source: RepoSourceInput) => apiData(api.environments(toValue(environmentId)).services.analyze.post({ source }))
	});
}

export function useCreateServicesFromPlan(environmentId: MaybeRefOrGetter<string>) {
	const api = useApi();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateFromPlanInput) => apiData(api.environments(toValue(environmentId)).services.fromPlan.post(input)),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServices(toValue(environmentId)) })
	});
}
