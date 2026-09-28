import { ProjectView } from '@/components/canvas/project-view';
import { draftProject, getProject, projects } from '@/lib/mock';

export const dynamicParams = false;

export function generateStaticParams() {
	return [...projects, draftProject].map(p => ({ projectId: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
	const { projectId } = await params;
	return { title: getProject(projectId)?.name };
}

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
	const { projectId } = await params;
	return <ProjectView projectId={projectId} />;
}
