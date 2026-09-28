'use client';

import {
	BotIcon,
	HomeIcon,
	KeyRoundIcon,
	LayersIcon,
	LogInIcon,
	MailIcon,
	MonitorIcon,
	MoonIcon,
	RocketIcon,
	ServerIcon,
	SettingsIcon,
	ShieldCheckIcon,
	SunIcon,
	UserIcon,
	UsersIcon
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { projects, teams } from '@/lib/mock';
import { TeamAvatar } from './team-switcher';
import { useAppState } from './app-state';

const nav = [
	{ label: 'Home', href: '/', icon: HomeIcon },
	{ label: 'Team settings', href: '/team/settings', icon: UsersIcon },
	{ label: 'Account', href: '/account', icon: UserIcon },
	{ label: 'AI access (MCP)', href: '/account#ai-access', icon: BotIcon },
	{ label: 'Cluster', href: '/admin/cluster', icon: ServerIcon },
	{ label: 'Users', href: '/admin/users', icon: ShieldCheckIcon },
	{ label: 'Platform settings', href: '/admin/settings', icon: SettingsIcon }
];

const previewScreens = [
	{ label: 'Sign in', href: '/login', icon: LogInIcon },
	{ label: 'Forgot password', href: '/forgot', icon: MailIcon },
	{ label: 'Reset password', href: '/reset', icon: KeyRoundIcon },
	{ label: 'Accept invite', href: '/accept', icon: MailIcon },
	{ label: 'First-run setup', href: '/setup', icon: RocketIcon },
	{ label: 'OAuth consent (MCP)', href: '/oauth/authorize', icon: BotIcon }
];

export function CommandPalette() {
	const { paletteOpen: open, setPaletteOpen: setOpen, teamId, setTeamId } = useAppState();
	const router = useRouter();
	const { setTheme } = useTheme();

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen(!open);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, setOpen]);

	const run = (fn: () => void) => {
		setOpen(false);
		fn();
	};

	return (
		<CommandDialog open={open} onOpenChange={setOpen} showCloseButton={false}>
			<CommandInput placeholder="Search projects, pages, actions…" />
			<CommandList>
				<CommandEmpty>No results.</CommandEmpty>
				<CommandGroup heading="Projects">
					{projects
						.filter(p => p.teamId === teamId)
						.map(p => (
							<CommandItem key={p.id} value={`project ${p.name}`} onSelect={() => run(() => router.push(`/project/${p.id}`))}>
								<LayersIcon />
								{p.name}
								<span className="ml-auto text-xs text-muted-foreground">{p.environments.length} envs</span>
							</CommandItem>
						))}
				</CommandGroup>
				<CommandGroup heading="Navigate">
					{nav.map(n => (
						<CommandItem key={n.href} onSelect={() => run(() => router.push(n.href))}>
							<n.icon />
							{n.label}
						</CommandItem>
					))}
				</CommandGroup>
				<CommandGroup heading="Switch team">
					{teams.map(t => (
						<CommandItem
							key={t.id}
							value={`team ${t.name}`}
							onSelect={() =>
								run(() => {
									setTeamId(t.id);
									router.push('/');
								})
							}
						>
							<TeamAvatar name={t.name} />
							{t.name}
						</CommandItem>
					))}
				</CommandGroup>
				<CommandGroup heading="Theme">
					<CommandItem onSelect={() => run(() => setTheme('light'))}>
						<SunIcon />
						Light theme
					</CommandItem>
					<CommandItem onSelect={() => run(() => setTheme('dark'))}>
						<MoonIcon />
						Dark theme
					</CommandItem>
					<CommandItem onSelect={() => run(() => setTheme('system'))}>
						<MonitorIcon />
						System theme
					</CommandItem>
				</CommandGroup>
				<CommandSeparator />
				<CommandGroup heading="Preview screens">
					{previewScreens.map(n => (
						<CommandItem key={n.href} onSelect={() => run(() => router.push(n.href))}>
							<n.icon />
							{n.label}
						</CommandItem>
					))}
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
