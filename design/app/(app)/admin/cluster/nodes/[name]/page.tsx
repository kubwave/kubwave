import { NodeDetail } from '@/components/admin/node-detail';
import { clusterNodes } from '@/lib/mock-admin';

export const dynamicParams = false;

export function generateStaticParams() {
	return clusterNodes.map(n => ({ name: n.name }));
}

export default async function NodePage({ params }: { params: Promise<{ name: string }> }) {
	const { name } = await params;
	return <NodeDetail name={name} />;
}
