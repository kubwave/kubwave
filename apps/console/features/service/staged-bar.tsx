'use client';

import { ChevronUpIcon, LoaderCircleIcon, RocketIcon, SaveIcon, Undo2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Service } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { ServiceIcon } from './service-icon';
import { useStagedChanges } from './staged-changes';

export function StagedBar({ services, shifted }: { services: Service[]; shifted: boolean }) {
	const staged = useStagedChanges();
	const { applying, discard, apply } = staged;
	// A deleted service's draft is settled on the next apply; until then it is not a pending change.
	const entries = staged.entries.filter(entry => services.some(service => service.id === entry.serviceId));
	if (entries.length === 0) return null;
	const changeCount = entries.reduce((sum, entry) => sum + entry.groups.length, 0);

	return (
		<div
			className={cn(
				'pointer-events-none absolute bottom-5 left-0 z-30 flex justify-center',
				shifted ? 'right-[min(720px,100%)] max-md:hidden' : 'right-0'
			)}
		>
			<div className="pointer-events-auto flex animate-in items-center gap-1 rounded-lg border bg-popover p-1 shadow-lg shadow-black/20 fade-in slide-in-from-bottom-2">
				<Popover>
					<PopoverTrigger className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
						<span className="font-mono text-xs tabular-nums">{changeCount}</span>
						<span className="font-medium">{changeCount === 1 ? 'change' : 'changes'} staged</span>
						<ChevronUpIcon className="size-3.5 text-muted-foreground" />
					</PopoverTrigger>
					<PopoverContent side="top" className="w-72 p-2">
						<div className="px-2 pt-1 pb-2 text-xs text-muted-foreground">Applied together: one save and deploy per service</div>
						{entries.map(entry => {
							const service = services.find(candidate => candidate.id === entry.serviceId);
							if (!service) return null;
							return (
								<div key={entry.serviceId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
									<ServiceIcon type={service.type} className="size-3.5" />
									<span className="font-medium">{service.name}</span>
									<span className="ml-auto truncate text-xs text-muted-foreground">{entry.groups.join(', ')}</span>
								</div>
							);
						})}
					</PopoverContent>
				</Popover>
				<Button variant="ghost" size="sm" disabled={applying} onClick={discard}>
					<Undo2Icon /> Discard
				</Button>
				<Button variant="outline" size="sm" disabled={applying} onClick={() => void apply(services, 'save')}>
					<SaveIcon /> Save
				</Button>
				<Button size="sm" disabled={applying} onClick={() => void apply(services, 'deploy')}>
					{applying ? <LoaderCircleIcon className="animate-spin" /> : <RocketIcon />} Deploy
				</Button>
			</div>
		</div>
	);
}
