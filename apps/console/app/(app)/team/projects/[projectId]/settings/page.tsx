import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { ProjectSettings } from '@/features/project/project-settings';
import { queryKeys } from '@/lib/api/query-keys';
import { serverPrefetch } from '@/lib/api/server-prefetch';

export const metadata: Metadata = { title: 'Project settings' };

export default async function ProjectSettingsPage({ params }: PageProps<'/team/projects/[projectId]/settings'>) {
	const { projectId } = await params;
	const state = await serverPrefetch(async seed => {
		await seed(queryKeys.project(projectId), api => api.projects(projectId).get());
	});
	return (
		<HydrationBoundary state={state}>
			<ProjectSettings projectId={projectId} />
		</HydrationBoundary>
	);
}
