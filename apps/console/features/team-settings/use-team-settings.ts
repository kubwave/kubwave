'use client';

import { apiData, type CreateSshKeyDto, type TeamMemberDto } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';

export function useTeamMembers(teamId: string | null) {
	return useQuery({
		queryKey: queryKeys.teamMembers(teamId ?? 'none'),
		queryFn: () => apiData(getBrowserApi().teams(teamId!).members.get()),
		enabled: Boolean(teamId)
	});
}

export function useTeamSshKeys(teamId: string | null) {
	return useQuery({
		queryKey: queryKeys.teamSshKeys(teamId ?? 'none'),
		queryFn: () => apiData(getBrowserApi().teams(teamId!).sshKeys.get()),
		enabled: Boolean(teamId)
	});
}

export function useRenameTeam(teamId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => apiData(getBrowserApi().teams(teamId).patch({ name })),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.teams })
	});
}

// Deleting or leaving removes the team from the list; callers await the refetch before routing away,
// else the next page briefly queries the old team id.
export function useDeleteTeam(teamId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => apiData(getBrowserApi().teams(teamId).delete()),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.teams })
	});
}

export function useLeaveTeam(teamId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (userId: string) => apiData(getBrowserApi().teams(teamId).members(userId).delete()),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.teams })
	});
}

export function useMemberMutations(teamId: string) {
	const queryClient = useQueryClient();
	const onSuccess = () => queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(teamId) });
	const members = () => getBrowserApi().teams(teamId).members;
	return {
		add: useMutation({ mutationFn: (email: string) => apiData(members().post({ email })), onSuccess }),
		setRole: useMutation({
			mutationFn: ({ userId, role }: { userId: string; role: TeamMemberDto['role'] }) => apiData(members()(userId).patch({ role })),
			onSuccess
		}),
		remove: useMutation({ mutationFn: (userId: string) => apiData(members()(userId).delete()), onSuccess })
	};
}

export function useSshKeyMutations(teamId: string) {
	const queryClient = useQueryClient();
	const onSuccess = () => queryClient.invalidateQueries({ queryKey: queryKeys.teamSshKeys(teamId) });
	const keys = () => getBrowserApi().teams(teamId).sshKeys;
	return {
		create: useMutation({ mutationFn: (input: CreateSshKeyDto) => apiData(keys().post(input)), onSuccess }),
		remove: useMutation({ mutationFn: (keyId: string) => apiData(keys()(keyId).delete()), onSuccess })
	};
}
