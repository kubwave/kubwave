'use client';

import { apiData, type TeamsListResponse } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';

export type TeamSummary = TeamsListResponse['teams'][number];

export const teamsQuery = { queryKey: queryKeys.teams, queryFn: () => apiData(getBrowserApi().teams.get()) };

// The team list plus the active team. The API tracks the active team (active_team cookie).
export function useTeams() {
	const query = useQuery(teamsQuery);
	const teams = query.data?.teams ?? [];
	const activeTeamId = query.data?.activeTeamId ?? teams[0]?.id ?? null;
	const activeTeam = teams.find(team => team.id === activeTeamId) ?? null;
	return { ...query, teams, activeTeamId, activeTeam };
}

// Switching re-scopes nearly every query, so everything is invalidated rather than enumerated.
export function useSwitchTeam() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (teamId: string) => apiData(getBrowserApi().teams.active.put({ teamId })),
		onSuccess: () => queryClient.invalidateQueries()
	});
}

export function useCreateTeam() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => apiData(getBrowserApi().teams.post({ name: name.trim() })),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.teams })
	});
}
