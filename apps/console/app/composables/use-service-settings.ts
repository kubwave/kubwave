import { useMutation, useQueryClient } from '@tanstack/vue-query';
import type { ApiClient } from '~/utils/api-client';
import type { Service } from '~/utils/types';
import { queryKeys } from '~/utils/query-keys';

// The settings form builds the full PATCH body; the config is too union-heavy to type here, so the call site asserts it.
// Deletion lives in useDeleteService so the canvas and settings form share one delete path.
export type ServiceUpdateInput = {
	name: string;
	description: string;
	config: unknown;
	autoDeploy?: { enabled: boolean };
};

export function useServiceSettings(service: MaybeRefOrGetter<Service>) {
	const api: ApiClient = useApi();
	const queryClient = useQueryClient();

	function invalidate(updated: Service) {
		void queryClient.invalidateQueries({ queryKey: queryKeys.service(updated.id) });
		void queryClient.invalidateQueries({ queryKey: queryKeys.serviceStatus(updated.id) });
		void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServices(updated.environmentId) });
	}

	const update = useMutation({
		mutationFn: (input: ServiceUpdateInput) => apiData(api.services(toValue(service).id).patch(input as never)),
		onSuccess: invalidate
	});

	return { update };
}
