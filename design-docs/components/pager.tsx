import { ArrowLeftIcon, ArrowRightIcon, PencilIcon } from 'lucide-react';
import Link from 'next/link';
import { flatNav, repoUrl } from '@/lib/nav';

export function Pager({ path }: { path: string }) {
	const index = flatNav.findIndex(item => item.path === path);
	const previous = flatNav[index - 1];
	const next = flatNav[index + 1];
	const source = path === '/templates' ? '/templates/index' : path;

	return (
		<footer className="mt-14 space-y-6 border-t pt-6">
			<a
				href={`${repoUrl}/edit/main/apps/docs/content${source}.md`}
				target="_blank"
				rel="noreferrer"
				className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			>
				<PencilIcon className="size-3.5" />
				Edit this page on GitHub
			</a>
			<div className="grid gap-3 sm:grid-cols-2">
				{previous ? (
					<Link href={`${previous.path}/`} className="rounded-lg border px-4 py-3 transition-colors hover:bg-accent">
						<span className="flex items-center gap-1 text-xs text-muted-foreground">
							<ArrowLeftIcon className="size-3" />
							Previous
						</span>
						<span className="mt-0.5 block text-sm font-medium">{previous.title}</span>
					</Link>
				) : (
					<span />
				)}
				{next && (
					<Link href={`${next.path}/`} className="rounded-lg border px-4 py-3 text-right transition-colors hover:bg-accent">
						<span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
							Next
							<ArrowRightIcon className="size-3" />
						</span>
						<span className="mt-0.5 block text-sm font-medium">{next.title}</span>
					</Link>
				)}
			</div>
		</footer>
	);
}
