import { useQuery } from '@tanstack/vue-query';
import type { TeamDeploymentsListResponse } from '@kubwave/api-client';
import { queryKeys } from '~/utils/query-keys';

export type TeamDeploymentItem = TeamDeploymentsListResponse[number];

// Recent deployments across all projects of a team — drives the dashboard activity feed.
export function useTeamDeployments(teamId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();
	return useQuery({
		queryKey: computed(() => queryKeys.teamDeployments(toValue(teamId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(teamId))),
		queryFn: () => apiData(api.teams(toValue(teamId)!).deployments.get()),
		// Deploys run out-of-band (auto-deploy, worker), so poll lightly instead of relying on invalidation.
		refetchInterval: 15_000
	});
}
