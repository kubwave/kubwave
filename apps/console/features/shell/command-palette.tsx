'use client';

import {
	ActivityIcon,
	BotIcon,
	HomeIcon,
	LayersIcon,
	MonitorIcon,
	MoonIcon,
	PlusIcon,
	SettingsIcon,
	ShieldCheckIcon,
	SunIcon,
	UserIcon,
	UsersIcon
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useSession } from '@/features/auth/session-provider';
import { useTeamProjects } from '@/features/project/use-project';
import { useSwitchTeam, useTeams } from '@/features/team/use-teams';
import { projectHref } from '@/lib/routes';
import { TeamAvatar } from './avatars';
import { useShellState } from './shell-state';

const pages = [
	{ label: 'Home', href: '/', icon: HomeIcon },
	{ label: 'Team settings', href: '/team/settings', icon: UsersIcon },
	{ label: 'Account', href: '/account', icon: UserIcon },
	{ label: 'AI access (MCP)', href: '/account/mcp', icon: BotIcon }
];

const adminPages = [
	{ label: 'Monitoring', href: '/admin/monitoring', icon: ActivityIcon },
	{ label: 'Users', href: '/admin/users', icon: ShieldCheckIcon },
	{ label: 'Platform settings', href: '/admin/settings', icon: SettingsIcon }
];

const themes = [
	{ value: 'light', label: 'Light theme', icon: SunIcon },
	{ value: 'dark', label: 'Dark theme', icon: MoonIcon },
	{ value: 'system', label: 'System theme', icon: MonitorIcon }
];

export function CommandPalette() {
	const router = useRouter();
	const { setTheme } = useTheme();
	const { user } = useSession();
	const { teams, activeTeamId } = useTeams();
	const projects = useTeamProjects(activeTeamId).data ?? [];
	const switchTeam = useSwitchTeam();
	const { paletteOpen: open, setPaletteOpen: setOpen, setCreateTeamOpen } = useShellState();

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setOpen(!open);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, setOpen]);

	const run = (action: () => void) => {
		setOpen(false);
		action();
	};

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			showCloseButton={false}
			title="Command palette"
			description="Search projects, pages and actions"
		>
			<CommandInput placeholder="Search projects, pages, actions…" />
			<CommandList>
				<CommandEmpty>No results.</CommandEmpty>
				{projects.length > 0 && (
					<CommandGroup heading="Projects">
						{projects.map(project => (
							<CommandItem key={project.id} value={`project ${project.name}`} onSelect={() => run(() => router.push(projectHref(project.id)))}>
								<LayersIcon />
								{project.name}
								<span className="ml-auto text-xs text-muted-foreground">{project.environmentCount} envs</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				<CommandGroup heading="Navigate">
					{[...pages, ...(user?.isAdmin ? adminPages : [])].map(page => (
						<CommandItem key={page.href} value={page.label} onSelect={() => run(() => router.push(page.href))}>
							<page.icon />
							{page.label}
						</CommandItem>
					))}
				</CommandGroup>
				<CommandGroup heading="Teams">
					{teams
						.filter(team => team.id !== activeTeamId)
						.map(team => (
							<CommandItem
								key={team.id}
								value={`team ${team.name}`}
								onSelect={() => run(() => switchTeam.mutate(team.id, { onSuccess: () => router.push('/') }))}
							>
								<TeamAvatar name={team.name} />
								Switch to {team.name}
							</CommandItem>
						))}
					<CommandItem value="create team" onSelect={() => run(() => setCreateTeamOpen(true))}>
						<PlusIcon />
						Create team
					</CommandItem>
				</CommandGroup>
				<CommandGroup heading="Theme">
					{themes.map(theme => (
						<CommandItem key={theme.value} value={theme.label} onSelect={() => run(() => setTheme(theme.value))}>
							<theme.icon />
							{theme.label}
						</CommandItem>
					))}
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
