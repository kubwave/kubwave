import type { TeamsListResponse } from '@kubwave/api-client';
import { HydrationBoundary } from '@tanstack/react-query';
import { HomePage } from '@/features/home/home-page';
import { queryKeys } from '@/lib/api/query-keys';
import { serverPrefetch } from '@/lib/api/server-prefetch';

export default async function Home() {
	const state = await serverPrefetch(async seed => {
		const teams = await seed<TeamsListResponse>(queryKeys.teams, api => api.teams.get());
		const teamId = teams?.activeTeamId ?? teams?.teams[0]?.id;
		if (teamId) await seed(queryKeys.teamProjects(teamId), api => api.teams(teamId).projects.get());
	});
	return (
		<HydrationBoundary state={state}>
			<HomePage />
		</HydrationBoundary>
	);
}
