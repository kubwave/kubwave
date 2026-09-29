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
import { useSwitchTeam, useTeams } from '@/features/team/use-teams';
import { TeamAvatar } from './avatars';
import { useShellState } from './shell-state';

export function TeamSwitcher() {
	const router = useRouter();
	const { teams, activeTeam } = useTeams();
	const switchTeam = useSwitchTeam();
	const { setCreateTeamOpen } = useShellState();

	const select = (teamId: string) =>
		switchTeam.mutate(teamId, {
			onSuccess: () => router.push('/'),
			onError: () => toast.error('Could not switch team')
		});

	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
				{activeTeam ? <TeamAvatar name={activeTeam.name} /> : null}
				<span className="max-w-32 truncate">{activeTeam?.name ?? 'No team'}</span>
				<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-60">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Teams</DropdownMenuLabel>
				{teams.map(team => (
					<DropdownMenuItem key={team.id} onSelect={() => team.id !== activeTeam?.id && select(team.id)}>
						<TeamAvatar name={team.name} />
						<span className="flex-1 truncate">{team.name}</span>
						{team.role === 'owner' && (
							<Badge variant="secondary" className="px-1.5 text-[10px]">
								owner
							</Badge>
						)}
						{team.id === activeTeam?.id && <CheckIcon className="size-4" />}
					</DropdownMenuItem>
				))}
				{teams.length > 0 && <DropdownMenuSeparator />}
				<DropdownMenuItem onSelect={() => setCreateTeamOpen(true)}>
					<PlusIcon className="size-4" />
					Create team
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
