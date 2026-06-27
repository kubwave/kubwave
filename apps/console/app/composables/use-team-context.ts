import { useQuery } from '@tanstack/vue-query';
import { teamsQuery } from '~/composables/use-team-data';

// The active team + team list, derived from the single /teams query the shell already loads.
export function useTeamContext() {
	const api = useApi();
	const { data, isPending, suspense } = useQuery(teamsQuery(api));

	const teams = computed(() => data.value?.teams ?? []);
	const activeTeamId = computed(() => data.value?.activeTeamId ?? teams.value[0]?.id ?? null);
	const activeTeam = computed(() => teams.value.find(team => team.id === activeTeamId.value) ?? null);

	return { data, teams, activeTeam, activeTeamId, isPending, suspense };
}
