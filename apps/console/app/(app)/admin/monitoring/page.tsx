import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { parseMonitoringTab } from '@/features/admin-monitoring/model';
import { MonitoringPage } from '@/features/admin-monitoring/monitoring-page';
import { queryKeys } from '@/lib/api/query-keys';
import { serverPrefetch } from '@/lib/api/server-prefetch';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Monitoring' };

export default async function Monitoring({ searchParams }: PageProps<'/admin/monitoring'>) {
	const tab = parseMonitoringTab(firstParam((await searchParams).tab));
	const state = await serverPrefetch(async seed => {
		await Promise.all([
			seed(queryKeys.clusterSnapshot, api => api.platform.cluster.get()),
			seed(queryKeys.clusterUsage('1h'), api => api.platform.cluster.usage.get({ range: '1h' }))
		]);
	});
	return (
		<HydrationBoundary state={state}>
			<MonitoringPage initialTab={tab} />
		</HydrationBoundary>
	);
}
