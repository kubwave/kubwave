import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { UsersPage } from '@/features/admin-users/users-page';
import { queryKeys } from '@/lib/api/query-keys';
import { serverPrefetch } from '@/lib/api/server-prefetch';

export const metadata: Metadata = { title: 'Users' };

export default async function Users() {
	const state = await serverPrefetch(async seed => {
		await Promise.all([seed(queryKeys.adminUsers, api => api.platform.users.get()), seed(queryKeys.invitations, api => api.invitations.get())]);
	});
	return (
		<HydrationBoundary state={state}>
			<UsersPage />
		</HydrationBoundary>
	);
}
