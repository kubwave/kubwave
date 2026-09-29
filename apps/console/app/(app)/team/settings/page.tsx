import type { TeamsListResponse } from '@kubwave/api-client';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { TeamSettings } from '@/features/team-settings/team-settings';
import { queryKeys } from '@/lib/api/query-keys';
import { serverPrefetch } from '@/lib/api/server-prefetch';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Team settings' };

export default async function TeamSettingsPage({ searchParams }: PageProps<'/team/settings'>) {
	const params = await searchParams;
	const query = {
		tab: firstParam(params.tab),
		installationId: firstParam(params.installation_id),
		gitGrant: firstParam(params.git_grant),
		gitError: firstParam(params.git_error)
	};
	const state = await serverPrefetch(async seed => {
		const teams = await seed<TeamsListResponse>(queryKeys.teams, api => api.teams.get());
		const teamId = teams?.activeTeamId ?? teams?.teams[0]?.id;
		if (!teamId) return;
		await Promise.all([
			seed(queryKeys.teamMembers(teamId), api => api.teams(teamId).members.get()),
			seed(queryKeys.teamSshKeys(teamId), api => api.teams(teamId).sshKeys.get())
		]);
	});
	return (
		<HydrationBoundary state={state}>
			<TeamSettings query={query} />
		</HydrationBoundary>
	);
}
