'use client';

import { FileTextIcon, HashIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { docsNav } from '@/lib/nav';
import type { SearchSection } from '@/lib/search-index';

// Items carry [section title, page title, section text] as keywords; `value` is the unique href.
// Substring instead of cmdk's fuzzy match, ranked title > page > body text.
function filter(_value: string, search: string, keywords: string[] = []) {
	const needle = search.trim().toLowerCase();
	const index = keywords.findIndex(keyword => keyword.toLowerCase().includes(needle));
	return index === -1 ? 0 : 1 - index * 0.25;
}

const isPageIntro = (section: SearchSection) => !section.href.includes('#');

// Same-page jumps go through location.hash so the hashchange reveals anchors inside closed tabs.
function useOpenSection() {
	const router = useRouter();
	return (href: string) => {
		const url = new URL(href, window.location.href);
		if (url.pathname === window.location.pathname && url.hash) window.location.hash = url.hash;
		else router.push(href);
	};
}

function useSearchSections(open: boolean): SearchSection[] | undefined {
	const [sections, setSections] = useState<SearchSection[]>();
	useEffect(() => {
		if (!open || sections) return;
		void fetch('/search.json')
			.then(response => response.json() as Promise<SearchSection[]>)
			.then(setSections)
			.catch(() => setSections([]));
	}, [open, sections]);
	return sections;
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const openSection = useOpenSection();
	const sections = useSearchSections(open);
	const [query, setQuery] = useState('');
	const visible = (sections ?? []).filter(section => query !== '' || isPageIntro(section));

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
			description="Search the documentation"
		>
			<CommandInput placeholder="Search installation, providers, templates…" value={query} onValueChange={setQuery} />
			<CommandList>
				<CommandEmpty>{sections ? 'No results.' : 'Loading…'}</CommandEmpty>
				{docsNav.map(group => (
					<CommandGroup key={group.title} heading={group.title}>
						{visible
							.filter(section => section.group === group.title)
							.map(section => (
								<CommandItem
									key={section.href}
									value={section.href}
									keywords={[section.title, section.page, section.text]}
									onSelect={() => {
										onOpenChange(false);
										openSection(section.href);
									}}
								>
									{isPageIntro(section) ? <FileTextIcon className="self-start" /> : <HashIcon className="self-start" />}
									<div className="min-w-0">
										<p>
											{section.title}
											{!isPageIntro(section) && <span className="text-muted-foreground"> · {section.page}</span>}
										</p>
										<p className="truncate text-xs text-muted-foreground">{section.text}</p>
									</div>
								</CommandItem>
							))}
					</CommandGroup>
				))}
			</CommandList>
		</CommandDialog>
	);
}
