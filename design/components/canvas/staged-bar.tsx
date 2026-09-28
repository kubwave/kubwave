'use client';

import { ChevronUpIcon, RocketIcon, Undo2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Service } from '@/lib/mock';
import { cn } from '@/lib/utils';
import { ServiceIcon } from '@/components/service/service-icon';

export type StagedChange = { serviceId: string; kind: string };

export function StagedBar({
	staged,
	services,
	onDiscard,
	onApply,
	shifted
}: {
	staged: StagedChange[];
	services: Service[];
	onDiscard: () => void;
	onApply: () => void;
	shifted: boolean;
}) {
	if (staged.length === 0) return null;
	return (
		<div
			className={cn(
				'pointer-events-none absolute bottom-5 left-0 flex justify-center',
				shifted ? 'right-[min(720px,100%)] max-md:hidden' : 'right-0'
			)}
		>
			<div className="pointer-events-auto flex animate-in items-center gap-1 rounded-lg border bg-popover py-1 pr-1 pl-1 shadow-lg shadow-black/20 fade-in slide-in-from-bottom-2">
				<Popover>
					<PopoverTrigger className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
						<span className="font-mono text-xs tabular-nums">{staged.length}</span>
						<span className="font-medium">{staged.length === 1 ? 'change' : 'changes'} staged</span>
						<ChevronUpIcon className="size-3.5 text-muted-foreground" />
					</PopoverTrigger>
					<PopoverContent side="top" className="w-72 p-2">
						<div className="px-2 pt-1 pb-2 text-xs text-muted-foreground">Applied together in one deploy per service</div>
						{staged.map(c => {
							const s = services.find(x => x.id === c.serviceId);
							if (!s) return null;
							return (
								<div key={`${c.serviceId}-${c.kind}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
									<ServiceIcon type={s.type} className="size-3.5" />
									<span className="font-medium">{s.name}</span>
									<span className="ml-auto text-xs text-muted-foreground">{c.kind}</span>
								</div>
							);
						})}
					</PopoverContent>
				</Popover>
				<Button variant="ghost" size="sm" onClick={onDiscard}>
					<Undo2Icon /> Discard
				</Button>
				<Button size="sm" onClick={onApply}>
					<RocketIcon /> Deploy
				</Button>
			</div>
		</div>
	);
}
