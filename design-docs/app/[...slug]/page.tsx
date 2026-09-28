import type { Metadata } from 'next';
import { Pager } from '@/components/pager';
import { loadPage } from '@/lib/content';
import { flatNav } from '@/lib/nav';

type Props = { params: Promise<{ slug: string[] }> };

export const dynamicParams = false;

export function generateStaticParams() {
	return flatNav.map(item => ({ slug: item.path.slice(1).split('/') }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	const { metadata } = await loadPage(`/${slug.join('/')}`);
	return metadata;
}

export default async function DocsPage({ params }: Props) {
	const { slug } = await params;
	const path = `/${slug.join('/')}`;
	const { default: Content, metadata } = await loadPage(path);
	const item = flatNav.find(entry => entry.path === path)!;

	return (
		<article data-docs-article>
			<p className="text-sm text-muted-foreground">{item.group}</p>
			<h1 className="mt-1.5 text-3xl font-semibold tracking-tight">{metadata.title}</h1>
			{metadata.description && <p className="mt-3 text-base text-muted-foreground">{metadata.description}</p>}
			<div className="mt-8">
				<Content />
			</div>
			<Pager path={path} />
		</article>
	);
}
