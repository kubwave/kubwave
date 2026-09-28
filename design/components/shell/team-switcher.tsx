'use client';

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { teams } from '@/lib/mock';
import { useAppState } from './app-state';

export function TeamAvatar({ name, className = 'size-5 text-[10px]' }: { name: string; className?: string }) {
	return (
		<span className={`inline-flex shrink-0 items-center justify-center rounded bg-foreground font-semibold text-background ${className}`}>
			{name[0]}
		</span>
	);
}

export function TeamSwitcher() {
	const { teamId, setTeamId } = useAppState();
	const router = useRouter();
	const team = teams.find(t => t.id === teamId)!;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
				<TeamAvatar name={team.name} />
				<span className="max-w-32 truncate">{team.name}</span>
				<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-60">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Teams</DropdownMenuLabel>
				{teams.map(t => (
					<DropdownMenuItem
						key={t.id}
						onSelect={() => {
							setTeamId(t.id);
							router.push('/');
						}}
					>
						<TeamAvatar name={t.name} />
						<span className="flex-1 truncate">{t.name}</span>
						{t.role === 'owner' && (
							<Badge variant="secondary" className="px-1.5 text-[10px]">
								owner
							</Badge>
						)}
						{t.id === teamId && <CheckIcon className="size-4" />}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => toast.success('Team created', { description: 'Preview only — nothing was saved.' })}>
					<PlusIcon className="size-4" />
					Create team
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
