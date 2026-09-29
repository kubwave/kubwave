import { HydrationBoundary } from '@tanstack/react-query';
import { ProjectCanvas } from '@/features/project/project-canvas';
import { queryKeys } from '@/lib/api/query-keys';
import type { ProjectDetail } from '@/lib/api/types';
import { serverPrefetch } from '@/lib/api/server-prefetch';
import { resolveEnvironment } from '@/lib/routes';
import { firstParam } from '@/lib/search-params';

export default async function ProjectPage({ params, searchParams }: PageProps<'/team/projects/[projectId]'>) {
	const { projectId } = await params;
	const env = firstParam((await searchParams).env);
	const state = await serverPrefetch(async seed => {
		const project = await seed<ProjectDetail>(queryKeys.project(projectId), api => api.projects(projectId).get());
		const environment = project && resolveEnvironment(project.environments, env);
		if (!environment) return;
		await Promise.all([
			seed(queryKeys.environmentServices(environment.id), api => api.environments(environment.id).services.get()),
			seed(queryKeys.environmentFlowLayout(environment.id), api => api.environments(environment.id).flowLayout.get())
		]);
	});
	return (
		<HydrationBoundary state={state}>
			<ProjectCanvas projectId={projectId} />
		</HydrationBoundary>
	);
}
