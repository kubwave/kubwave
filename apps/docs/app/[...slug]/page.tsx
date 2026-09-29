import type { Metadata } from 'next';
import { Pager } from '@/components/pager';
import { loadPage } from '@/lib/content';
import { findNavEntry, flatNav } from '@/lib/nav';

type Props = { params: Promise<{ slug: string[] }> };

export const dynamicParams = false;

export function generateStaticParams() {
	return flatNav.map(item => ({ slug: item.path.slice(1).split('/') }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { slug } = await params;
	const path = `/${slug.join('/')}`;
	const { title, description } = (await loadPage(path)).metadata;
	// Canonical points at the stable site, also from the next channel's build.
	return { title, description, alternates: { canonical: `${path}/` }, openGraph: { title, description, url: `${path}/` } };
}

export default async function DocsPage({ params }: Props) {
	const { slug } = await params;
	const path = `/${slug.join('/')}`;
	const { default: Content, metadata } = await loadPage(path);
	const entry = findNavEntry(path)!;

	return (
		<article data-docs-article>
			<p className="text-sm text-muted-foreground">{entry.group}</p>
			<h1 className="mt-1.5 text-3xl font-semibold tracking-tight">{metadata.title}</h1>
			<p className="mt-3 text-base text-muted-foreground">{metadata.description}</p>
			<div className="mt-8">
				<Content />
			</div>
			<Pager path={path} />
		</article>
	);
}
