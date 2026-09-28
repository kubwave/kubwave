'use client';

import { FileTextIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { docsNav } from '@/lib/nav';

// Substring instead of cmdk's fuzzy match; title hits rank above description hits.
function filter(value: string, search: string, keywords?: string[]) {
	const needle = search.trim().toLowerCase();
	if (value.toLowerCase().includes(needle)) return 1;
	return keywords?.some(keyword => keyword.toLowerCase().includes(needle)) ? 0.5 : 0;
}

export type SearchPage = { title: string; path: string; group: string; description: string };

export function SearchDialog({ pages, open, onOpenChange }: { pages: SearchPage[]; open: boolean; onOpenChange: (open: boolean) => void }) {
	const router = useRouter();

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				onOpenChange(!open);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onOpenChange]);

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			showCloseButton={false}
			filter={filter}
			title="Search docs"
			description="Search documentation pages"
		>
			<CommandInput placeholder="Search docs…" />
			<CommandList>
				<CommandEmpty>No results.</CommandEmpty>
				{docsNav.map(group => (
					<CommandGroup key={group.title} heading={group.title}>
						{pages
							.filter(page => page.group === group.title)
							.map(page => (
								<CommandItem
									key={page.path}
									value={page.title}
									keywords={[page.description]}
									onSelect={() => {
										onOpenChange(false);
										router.push(`${page.path}/`);
									}}
								>
									<FileTextIcon className="self-start" />
									<div className="min-w-0">
										<p>{page.title}</p>
										<p className="truncate text-xs text-muted-foreground">{page.description}</p>
									</div>
								</CommandItem>
							))}
					</CommandGroup>
				))}
			</CommandList>
		</CommandDialog>
	);
}
