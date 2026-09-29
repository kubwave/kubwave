'use client';

import { apiData } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import type { Deployment } from '@/lib/api/types';
import { hasBuildStep, shouldPollDeploymentLogs } from '@/lib/deployments';

export const isLiveDeployment = (deployment: Deployment | undefined) =>
	deployment?.status === 'pending' || deployment?.status === 'deploying' || deployment?.status === 'canceling';

// Deployment history of a service, polled every 2s while open, plus deploy and cancel.
export function useServiceDeployments(serviceId: string, environmentId: string) {
	const queryClient = useQueryClient();
	const deployments = useQuery({
		queryKey: queryKeys.serviceDeployments(serviceId),
		queryFn: () => apiData(getBrowserApi().services(serviceId).deployments.get()),
		refetchInterval: 2000
	});
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.serviceDeployments(serviceId) });
		void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServiceStatus(environmentId) });
	};
	const deploy = useMutation({
		mutationFn: () => apiData(getBrowserApi().services(serviceId).deployments.post()),
		onSuccess: () => {
			refresh();
			toast.success('Deployment started');
		},
		onError: () => toast.error('Could not start deployment')
	});
	const cancel = useMutation({
		mutationFn: (deploymentId: string) => apiData(getBrowserApi().deployments(deploymentId).cancel.post()),
		onSuccess: () => {
			refresh();
			toast.success('Deployment cancellation requested');
		},
		onError: () => toast.error('Could not cancel deployment')
	});
	const list = deployments.data ?? [];
	return { deployments: list, isPending: deployments.isPending, active: list.find(isLiveDeployment), deploy, cancel };
}

// Event timeline and build output of one deployment; both poll while it runs.
export function useDeploymentLogs(deployment: Deployment, enabled: boolean) {
	const poll = shouldPollDeploymentLogs(deployment) ? 2000 : false;
	const events = useQuery({
		queryKey: queryKeys.deploymentLogs(deployment.id),
		queryFn: () => apiData(getBrowserApi().deployments(deployment.id).logs.get()),
		enabled,
		refetchInterval: poll
	});
	const build = useQuery({
		queryKey: queryKeys.deploymentBuildLogs(deployment.id),
		queryFn: () => apiData(getBrowserApi().deployments(deployment.id).buildLogs.get()),
		enabled: enabled && hasBuildStep(deployment),
		refetchInterval: poll
	});
	return {
		events: events.data?.logs ?? [],
		eventsPending: events.isPending,
		buildContainers: (build.data?.containers ?? []).filter(container => container.content.length > 0)
	};
}
