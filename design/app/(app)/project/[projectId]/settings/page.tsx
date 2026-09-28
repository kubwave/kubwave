import type { Metadata } from 'next';
import { ProjectSettings } from '@/components/settings/project-settings';
import { projects } from '@/lib/mock';

export const metadata: Metadata = { title: 'Project settings' };
export const dynamicParams = false;

export function generateStaticParams() {
	return projects.map(p => ({ projectId: p.id }));
}

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
	const { projectId } = await params;
	return <ProjectSettings projectId={projectId} />;
}
