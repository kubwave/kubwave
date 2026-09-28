'use client';

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { channelSites, channelUrl, docsChannel, type DocsChannel } from '@/lib/channel';
import { cn } from '@/lib/utils';

const dotClass: Record<DocsChannel, string> = { latest: 'bg-success', next: 'bg-warning' };
const channels = Object.keys(channelSites) as DocsChannel[];

// Keeps the reader on the same page across channels; the other site's 404 page covers
// pages that only exist on one side.
export function VersionSwitcher() {
	const pathname = usePathname();
	const current = channelSites[docsChannel];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" aria-label="Switch documentation version">
					<span className={cn('size-1.5 rounded-full', dotClass[docsChannel])} />
					{current.label}
					<ChevronsUpDownIcon className="size-3 text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Documentation version</DropdownMenuLabel>
				{channels.map(channel => (
					<DropdownMenuItem key={channel} asChild>
						<a href={channel === docsChannel ? pathname : channelUrl(channel, pathname)} className="gap-2.5">
							<span className={cn('size-1.5 shrink-0 rounded-full', dotClass[channel])} />
							<span className="flex flex-1 flex-col">
								<span className="text-sm font-medium">{channelSites[channel].label}</span>
								<span className="text-xs text-muted-foreground">{channelSites[channel].caption}</span>
							</span>
							{channel === docsChannel && <CheckIcon />}
						</a>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
