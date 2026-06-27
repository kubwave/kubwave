import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';

// Deployment history (polled every 2s while open) + the trigger mutation. Shared by the drawer header, Overview, and Deployments tab.
export function useServiceDeployments(
	serviceId: MaybeRefOrGetter<string | null | undefined>,
	environmentId?: MaybeRefOrGetter<string | null | undefined>
) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	function invalidateDeploymentState() {
		const id = toValue(serviceId);
		const envId = toValue(environmentId);
		if (id) {
			void queryClient.invalidateQueries({ queryKey: queryKeys.serviceDeployments(id) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.serviceStatus(id) });
		}
		if (envId) {
			void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServiceStatus(envId) });
		}
	}

	const { data, isPending } = useQuery({
		queryKey: computed(() => queryKeys.serviceDeployments(toValue(serviceId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(serviceId))),
		refetchInterval: 2000,
		queryFn: async () => {
			const id = toValue(serviceId);
			return apiData(api.services(id!).deployments.get()).catch(() => {
				throw new Error('Failed to load deployments');
			});
		}
	});

	const deployments = computed(() => data.value ?? []);
	const latestDeployment = computed(() => deployments.value[0] ?? null);
	const activeDeployment = computed(
		() =>
			deployments.value.find(
				deployment => deployment.status === 'pending' || deployment.status === 'deploying' || deployment.status === 'canceling'
			) ?? null
	);

	const deploy = useMutation({
		mutationFn: async () => {
			const id = toValue(serviceId);
			if (!id) throw new Error('No service');
			return apiData(api.services(id).deployments.post()).catch(() => {
				throw new Error('Failed to start deployment');
			});
		},
		onSuccess: () => {
			invalidateDeploymentState();
			toast.success('Deployment started');
		},
		onError: () => toast.error('Could not start deployment')
	});

	const cancelDeployment = useMutation({
		mutationFn: async (deploymentId: string) => {
			return apiData(api.deployments(deploymentId).cancel.post()).catch(() => {
				throw new Error('Failed to cancel deployment');
			});
		},
		onSuccess: () => {
			invalidateDeploymentState();
			toast.success('Deployment cancellation requested');
		},
		onError: () => toast.error('Could not cancel deployment')
	});

	return { deployments, latestDeployment, activeDeployment, isLoading: isPending, deploy, cancelDeployment };
}
