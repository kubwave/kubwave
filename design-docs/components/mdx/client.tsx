'use client';

import { Children, isValidElement, useRef } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Tabs as UiTabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { installCommand } from '@/lib/nav';
import { cn } from '@/lib/utils';

type TabProps = { label: string; children: React.ReactNode };

// Client component so its props (label) survive the RSC boundary into <Tabs>.
export function Tab({ children }: TabProps) {
	return <>{children}</>;
}

export function Tabs({ children }: { children: React.ReactNode }) {
	const tabs = Children.toArray(children).filter(isValidElement<TabProps>);
	return (
		<UiTabs defaultValue={tabs[0]?.props.label} className="my-6 gap-0">
			<TabsList variant="line" className="h-auto w-full justify-start gap-4 rounded-none border-b p-0">
				{tabs.map(tab => (
					<TabsTrigger key={tab.props.label} value={tab.props.label} className="flex-none px-0 pb-2 after:bottom-[-1px]">
						{tab.props.label}
					</TabsTrigger>
				))}
			</TabsList>
			{tabs.map(tab => (
				<TabsContent key={tab.props.label} value={tab.props.label} className="pt-1 [&>*:first-child]:mt-4">
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
	return (
		<div className="my-6 flex items-center gap-3 rounded-lg border bg-muted/40 py-2 pr-2 pl-4 font-mono text-[0.8125rem]">
			<span className="text-muted-foreground select-none">$</span>
			<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{installCommand}</code>
			<CopyButton value={installCommand} label="Copy install command" />
		</div>
	);
}
