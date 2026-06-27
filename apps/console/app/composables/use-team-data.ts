import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { TeamsListResponse } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';
import { teamErrorMessage } from '~/utils/team-errors';

export type TeamsData = TeamsListResponse;
export type TeamSummary = TeamsData['teams'][number];

export function teamsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.teams,
		queryFn: () => apiData(api.teams.get())
	};
}

export async function fetchTeamMembers(api: ApiClient, teamId: string) {
	return apiData(api.teams(teamId).members.get());
}

export function teamMembersQuery(api: ApiClient, teamId: string) {
	return {
		queryKey: queryKeys.teamMembers(teamId),
		queryFn: () => fetchTeamMembers(api, teamId)
	};
}

export function useTeamMembers(teamId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();

	return useQuery({
		queryKey: computed(() => queryKeys.teamMembers(toValue(teamId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(teamId))),
		queryFn: () => fetchTeamMembers(api, toValue(teamId)!)
	});
}

// Switching a team re-scopes nearly every query, so invalidate everything rather than enumerate.
// The active_team cookie is set server-side by the PUT's Set-Cookie.
export function useSwitchTeam() {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (teamId: string) => apiData(api.teams.active.put({ teamId })),
		onSuccess: () => void queryClient.invalidateQueries()
	});
}

export function useCreateTeam() {
	const api = useApi();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (name: string) => apiData(api.teams.post({ name: name.trim() })),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.teams })
	});
}

export function useRenameTeam(teamId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: async (name: string) => {
			const trimmed = name.trim();
			if (!trimmed) throw new Error('Enter a team name.');
			const id = toValue(teamId);
			if (!id) throw new Error('team_not_found');
			return apiData(api.teams(id).patch({ name: trimmed })).catch(err => {
				throw new Error(errorCode(err));
			});
		},
		onSuccess: (_data, name) => {
			toast.success('Team renamed', `Renamed to ${name}.`);
			void queryClient.invalidateQueries({ queryKey: queryKeys.teams });
		},
		onError: (err: Error) => {
			toast.error('Could not rename team', teamErrorMessage(err.message));
		}
	});
}

export function useDeleteTeam(team: MaybeRefOrGetter<{ name: string } | null | undefined>) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: async (teamId: string) => {
			await apiData(api.teams(teamId).delete()).catch(err => {
				throw new Error(errorCode(err));
			});
		},
		onSuccess: async () => {
			const teamName = toValue(team)?.name ?? 'Team';
			toast.success('Team deleted', `${teamName} has been deleted.`);
			// Resolve the team list before routing, else the dashboard briefly queries the just-deleted team id and flashes the wrong empty state.
			await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
			await navigateTo('/');
		},
		onError: (err: Error) => {
			toast.error('Could not delete team', teamErrorMessage(err.message));
		}
	});
}
