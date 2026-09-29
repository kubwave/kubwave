'use client';

import { apiData } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorCode } from '@/lib/api/api-error';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { userErrorMessage, type AdminUser, type Invitation } from './model';

export function useAdminUsers() {
	return useQuery({ queryKey: queryKeys.adminUsers, queryFn: () => apiData(getBrowserApi().platform.users.get()) });
}

export function useInvitations() {
	return useQuery({ queryKey: queryKeys.invitations, queryFn: () => apiData(getBrowserApi().invitations.get()) });
}

function useInvalidate(queryKey: readonly string[]) {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey });
}

// Toasts live on the mutation, not on each mutate() call: per-call callbacks only fire for the
// latest call while the table is mounted, so a second row action or a tab switch would drop them.
export function useSetAdmin() {
	const invalidate = useInvalidate(queryKeys.adminUsers);
	return useMutation({
		mutationFn: ({ user, isAdmin }: { user: AdminUser; isAdmin: boolean }) => apiData(getBrowserApi().platform.users(user.id).patch({ isAdmin })),
		onSuccess: (_result, { user, isAdmin }) => {
			toast.success(isAdmin ? `${user.name} is now an admin` : `Removed admin access from ${user.name}`);
			return invalidate();
		},
		onError: err => toast.error('Could not update user', { description: userErrorMessage(errorCode(err)) })
	});
}

export function useDeleteUser() {
	const invalidate = useInvalidate(queryKeys.adminUsers);
	return useMutation({
		mutationFn: (user: AdminUser) => apiData(getBrowserApi().platform.users(user.id).delete()),
		onSuccess: (_result, user) => {
			toast.success('User deleted', { description: `${user.email} has been removed.` });
			return invalidate();
		},
		onError: err => toast.error('Could not delete user', { description: userErrorMessage(errorCode(err)) })
	});
}

export function useInviteUser() {
	const onSuccess = useInvalidate(queryKeys.invitations);
	return useMutation({
		mutationFn: (input: { email: string; isAdmin: boolean }) => apiData(getBrowserApi().invitations.post(input)),
		onSuccess
	});
}

export function useResendInvitation() {
	const invalidate = useInvalidate(queryKeys.invitations);
	return useMutation({
		mutationFn: (invitation: Invitation) => apiData(getBrowserApi().invitations(invitation.id).resend.post()),
		onSuccess: (result, invitation) => {
			if (result.emailSent) toast.success('Invitation re-sent', { description: `A new invite email was sent to ${invitation.email}.` });
			else toast.warning('Invitation updated — email not sent', { description: result.emailError });
			return invalidate();
		},
		onError: () => toast.error('Could not resend invitation')
	});
}

export function useRevokeInvitation() {
	const invalidate = useInvalidate(queryKeys.invitations);
	return useMutation({
		mutationFn: (invitation: Invitation) => apiData(getBrowserApi().invitations(invitation.id).delete()),
		onSuccess: (_result, invitation) => {
			toast.success('Invitation revoked', { description: invitation.email });
			return invalidate();
		},
		onError: () => toast.error('Could not revoke invitation')
	});
}
