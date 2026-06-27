import { useMutation, useQueryClient } from '@tanstack/vue-query';
import type { InvitationsCreateData, InvitationsListResponse } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type Invitation = InvitationsListResponse[number];
export type InviteUserInput = InvitationsCreateData['body'];

export async function fetchInvitations(api: ApiClient) {
	return apiData(api.invitations.get());
}

export function invitationsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.invitations,
		queryFn: () => fetchInvitations(api)
	};
}

export function useAdminInvitationActions() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();
	const busyInviteId = ref<string | null>(null);

	const resendInvite = useMutation({
		mutationFn: async (id: string) => {
			busyInviteId.value = id;
			return apiData(api.invitations(id).resend.post()).catch(() => {
				throw new Error('failed');
			});
		},
		onSuccess: result => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
			if (result.emailSent) {
				toast.success('Invitation re-sent');
			} else {
				toast.warning('Invitation updated — email not sent', result.emailError ?? undefined);
			}
		},
		onError: () => toast.error('Could not resend invitation'),
		onSettled: () => {
			busyInviteId.value = null;
		}
	});

	const revokeInvite = useMutation({
		mutationFn: async (id: string) => {
			busyInviteId.value = id;
			await apiData(api.invitations(id).delete()).catch(() => {
				throw new Error('failed');
			});
		},
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.invitations }),
		onError: () => toast.error('Could not revoke invitation'),
		onSettled: () => {
			busyInviteId.value = null;
		}
	});

	return { busyInviteId, resendInvite, revokeInvite };
}

export function useInviteUser(options: { onDone?: () => void; onEmailInUse?: () => void } = {}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const invite = useMutation({
		mutationFn: async ({ email, isAdmin }: InviteUserInput) => {
			return apiData(api.invitations.post({ email, isAdmin })).catch(err => {
				throw new Error(errorCode(err) === 'email_in_use' ? 'email_in_use' : 'unknown');
			});
		},
		onSuccess: (result, variables) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
			if (result.emailSent) {
				toast.success('Invitation sent', `An invite email was sent to ${variables.email}.`);
			} else {
				toast.warning('Invitation created — email not sent', `${result.emailError ?? 'SMTP error'}. Configure SMTP in Settings, then resend.`);
			}
			options.onDone?.();
		},
		onError: (err: Error) => {
			if (err.message === 'email_in_use') {
				options.onEmailInUse?.();
			} else {
				toast.error('Could not create invitation', 'Please try again.');
			}
		}
	});

	return { invite };
}
