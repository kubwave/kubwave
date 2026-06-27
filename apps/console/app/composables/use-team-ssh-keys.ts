import { useQuery } from '@tanstack/vue-query';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export async function fetchTeamSshKeys(api: ApiClient, teamId: string) {
	return apiData(api.teams(teamId).sshKeys.get()).catch(() => {
		throw new Error('Failed to load SSH keys');
	});
}

export function teamSshKeysQuery(api: ApiClient, teamId: string) {
	return {
		queryKey: queryKeys.teamSshKeys(teamId),
		queryFn: () => fetchTeamSshKeys(api, teamId)
	};
}

export function useTeamSshKeys(teamId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();

	return useQuery({
		queryKey: computed(() => queryKeys.teamSshKeys(toValue(teamId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(teamId))),
		queryFn: () => fetchTeamSshKeys(api, toValue(teamId)!)
	});
}
