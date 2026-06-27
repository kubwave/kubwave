import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';
import type { Service } from '~/utils/types';

// Owns environment-level cache invalidation so create/delete flows don't re-implement it; the canvas adds project-serviceCount + drawer/selection on top.

// The create body is union-heavy per service type, so the call site asserts it.
export type ServiceCreateInput = {
	name: string;
	description: string;
	type: string;
	config: unknown;
	autoDeploy?: { enabled: boolean };
};

export function useCreateService(environmentId: MaybeRefOrGetter<string>) {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: ServiceCreateInput): Promise<Service> => apiData(api.environments(toValue(environmentId)).services.post(input as never)),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServices(toValue(environmentId)) })
	});
}

export function useDeleteService(environmentId: MaybeRefOrGetter<string>) {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (serviceId: string) => apiData(api.services(serviceId).delete()),
		onSuccess: (_result, serviceId) => {
			const envId = toValue(environmentId);
			void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServices(envId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.environmentFlowLayout(envId) });
			queryClient.removeQueries({ queryKey: queryKeys.service(serviceId) });
		}
	});
}
