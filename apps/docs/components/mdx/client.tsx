'use client';

import { Children, isValidElement, useEffect, useRef, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Tabs as UiTabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buildInstallCommand, docsChannel } from '@/lib/channel';
import { cn } from '@/lib/utils';

type TabProps = { label: string; children: React.ReactNode };

// Client component so its props (label) survive the RSC boundary into <Tabs>.
export function Tab({ children }: TabProps) {
	return <>{children}</>;
}

// Opens the tab that holds the URL's #anchor (search results, TOC links), then scrolls to it.
function useRevealHashTarget(root: React.RefObject<HTMLElement | null>, select: (label: string) => void) {
	useEffect(() => {
		const reveal = () => {
			const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
			const panel = target?.closest<HTMLElement>('[data-tab-label]');
			if (!target || !panel || !root.current?.contains(panel)) return;
			select(panel.dataset.tabLabel!);
			requestAnimationFrame(() => target.scrollIntoView());
		};
		reveal();
		window.addEventListener('hashchange', reveal);
		return () => window.removeEventListener('hashchange', reveal);
	}, [root, select]);
}

// Inactive panels stay mounted (just hidden) so their headings keep anchors in the static HTML.
export function Tabs({ children }: { children: React.ReactNode }) {
	const tabs = Children.toArray(children).filter(isValidElement<TabProps>);
	const [active, setActive] = useState(tabs[0]?.props.label);
	const root = useRef<HTMLDivElement>(null);
	useRevealHashTarget(root, setActive);

	return (
		<UiTabs ref={root} value={active} onValueChange={setActive} className="my-6 gap-0">
			<TabsList variant="line" className="h-auto w-full justify-start gap-4 rounded-none border-b p-0">
				{tabs.map(tab => (
					<TabsTrigger key={tab.props.label} value={tab.props.label} className="flex-none px-0 pb-2 after:bottom-[-1px]">
						{tab.props.label}
					</TabsTrigger>
				))}
			</TabsList>
			{tabs.map(tab => (
				<TabsContent
					key={tab.props.label}
					value={tab.props.label}
					forceMount
					data-tab-label={tab.props.label}
					className="pt-1 data-[state=inactive]:hidden [&>*:first-child]:mt-4"
				>
					{tab.props.children}
				</TabsContent>
			))}
		</UiTabs>
	);
}

export function Pre({ className, ...props }: React.ComponentProps<'pre'>) {
	const ref = useRef<HTMLPreElement>(null);
	return (
		<div className="group/code relative my-5 rounded-lg border bg-muted/40">
			<pre ref={ref} className={cn('overflow-x-auto px-4 py-3 font-mono text-[0.8125rem] leading-6', className)} {...props} />
			<div className="absolute top-2 right-2 rounded-md bg-muted opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
				<CopyButton value={() => ref.current?.innerText.trimEnd() ?? ''} label="Copy code" />
			</div>
		</div>
	);
}

export function InstallCommand() {
	const installCommand = buildInstallCommand(docsChannel);
	return (
		<div className="my-6 flex items-center gap-3 rounded-lg border bg-muted/40 py-2 pr-2 pl-4 font-mono text-[0.8125rem]">
			<span className="text-muted-foreground select-none">$</span>
			<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{installCommand}</code>
			<CopyButton value={installCommand} label="Copy install command" />
		</div>
	);
}
