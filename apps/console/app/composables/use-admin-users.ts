import { useMutation, useQueryClient } from '@tanstack/vue-query';
import type { PlatformUsersListResponse } from '@kubwave/api-client';
import { queryKeys } from '~/utils/query-keys';
import type { ApiClient } from '~/utils/api-client';

export type AdminUser = PlatformUsersListResponse[number];

function userErrorMessage(error: string): string {
	switch (error) {
		case 'last_admin':
			return "You can't remove the last admin.";
		case 'self_demotion':
			return "You can't remove your own admin access.";
		case 'self_delete':
			return "You can't delete your own account.";
		case 'user_not_found':
			return 'That user no longer exists.';
		default:
			return 'Something went wrong. Please try again.';
	}
}

export async function fetchAdminUsers(api: ApiClient) {
	return apiData(api.platform.users.get());
}

export function adminUsersQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.adminUsers,
		queryFn: () => fetchAdminUsers(api)
	};
}

export function useAdminUserActions() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();
	const busyUserId = ref<string | null>(null);

	const toggleAdmin = useMutation({
		mutationFn: async ({ id, isAdmin }: { id: string; isAdmin: boolean }) => {
			busyUserId.value = id;
			return apiData(api.platform.users(id).patch({ isAdmin })).catch(err => {
				throw new Error(errorCode(err));
			});
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
		},
		onError: (err: Error) => {
			toast.error('Could not update user', userErrorMessage(err.message));
		},
		onSettled: () => {
			busyUserId.value = null;
		}
	});

	const deleteUser = useMutation({
		mutationFn: async ({ id }: { id: string; email: string }) => {
			busyUserId.value = id;
			await apiData(api.platform.users(id).delete()).catch(err => {
				throw new Error(errorCode(err));
			});
		},
		onSuccess: (_data, { email }) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
			toast.success('User deleted', `${email} has been removed.`);
		},
		onError: (err: Error) => {
			toast.error('Could not delete user', userErrorMessage(err.message));
		},
		onSettled: () => {
			busyUserId.value = null;
		}
	});

	return { busyUserId, toggleAdmin, deleteUser };
}
