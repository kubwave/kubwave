import { useQuery } from '@tanstack/vue-query';
import { adminUsersQuery, type AdminUser } from '~/composables/use-admin-users';
import { invitationsQuery, type Invitation } from '~/composables/use-admin-invitations';

// The admin users + invitations lists from the two prefetched queries, so the cache keys live in one place.
export function useAdminUsersData() {
	// useApi() must be called at setup scope, not inside the queryFn.
	const api = useApi();

	const { data: usersData, isPending: usersPending } = useQuery({
		...adminUsersQuery(api)
	});

	const { data: invitationsData, isPending: invitationsPending } = useQuery({
		...invitationsQuery(api)
	});

	const users = computed<AdminUser[]>(() => usersData.value ?? []);
	const adminCount = computed(() => users.value.filter(u => u.isAdmin).length);
	const pendingInvitations = computed<Invitation[]>(() => (invitationsData.value ?? []).filter(i => i.status !== 'accepted'));

	return { users, adminCount, pendingInvitations, usersPending, invitationsPending };
}
