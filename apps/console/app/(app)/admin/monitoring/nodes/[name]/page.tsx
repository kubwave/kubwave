import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { NodeDetail } from '@/features/admin-monitoring/node-detail';
import { queryKeys } from '@/lib/api/query-keys';
import { serverPrefetch } from '@/lib/api/server-prefetch';

export async function generateMetadata({ params }: PageProps<'/admin/monitoring/nodes/[name]'>): Promise<Metadata> {
	const { name } = await params;
	return { title: `${name} · Monitoring` };
}

export default async function NodePage({ params }: PageProps<'/admin/monitoring/nodes/[name]'>) {
	const { name } = await params;
	const state = await serverPrefetch(async seed => {
		await Promise.all([
			seed(queryKeys.clusterNode(name), api => api.platform.cluster.nodes(name).get()),
			seed(queryKeys.clusterNodeUsage(name, '1h'), api => api.platform.cluster.nodes(name).usage.get({ range: '1h' }))
		]);
	});
	return (
		<HydrationBoundary state={state}>
			<NodeDetail name={name} />
		</HydrationBoundary>
	);
}
