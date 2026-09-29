import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { settingsTab } from '@/features/admin-settings/model';
import { PlatformSettingsPage } from '@/features/admin-settings/platform-settings-page';
import { queryKeys } from '@/lib/api/query-keys';
import { serverPrefetch } from '@/lib/api/server-prefetch';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Platform settings' };

export default async function AdminSettingsPage({ searchParams }: PageProps<'/admin/settings'>) {
	const params = await searchParams;
	const gitError = firstParam(params.git_error);
	const githubConnected = firstParam(params.connected) === '1';
	const state = await serverPrefetch(async seed => {
		await Promise.all([
			seed(queryKeys.version, api => api.platform.version.get()),
			seed(queryKeys.updates, api => api.platform.updates.get()),
			seed(queryKeys.health, api => api.health.get({ verbose: 'true' }))
		]);
	});
	return (
		<HydrationBoundary state={state}>
			<PlatformSettingsPage
				initialTab={settingsTab(firstParam(params.tab), githubConnected || gitError !== undefined)}
				githubConnected={githubConnected}
				gitError={gitError}
			/>
		</HydrationBoundary>
	);
}
