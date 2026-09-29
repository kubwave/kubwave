'use client';

import { CheckIcon, ChevronsUpDownIcon, GitPullRequestIcon, LayersIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useProject, useTeamProjects } from '@/features/project/use-project';
import { useTeams } from '@/features/team/use-teams';
import type { Environment } from '@/lib/api/types';
import { projectHref, projectSettingsHref, resolveEnvironment } from '@/lib/routes';
import { cn } from '@/lib/utils';

const trigger =
	'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring';

export function EnvironmentDot({ environment, className }: { environment: Pick<Environment, 'name' | 'kind'>; className?: string }) {
	if (environment.kind === 'preview') return <GitPullRequestIcon className={cn('size-3.5 text-primary-text', className)} />;
	return <span className={cn('size-2 shrink-0 rounded-full', environment.name === 'production' ? 'bg-success' : 'bg-warning', className)} />;
}

export function ProjectSwitcher({ projectId }: { projectId: string }) {
	const { activeTeamId } = useTeams();
	const project = useProject(projectId).data;
	const projects = useTeamProjects(activeTeamId).data ?? [];
	if (!project) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className={trigger}>
				<span className="max-w-40 truncate">{project.name}</span>
				<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
				{projects.map(item => (
					<DropdownMenuItem key={item.id} asChild>
						<Link href={projectHref(item.id)}>
							<LayersIcon className="size-4 text-muted-foreground" />
							<span className="flex-1 truncate">{item.name}</span>
							{item.id === projectId && <CheckIcon className="size-4" />}
						</Link>
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href={projectSettingsHref(projectId)}>
						<SettingsIcon className="size-4" />
						Project settings
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function EnvironmentSwitcher({ projectId }: { projectId: string }) {
	const searchParams = useSearchParams();
	const project = useProject(projectId).data;
	const current = project && resolveEnvironment(project.environments, searchParams.get('env') ?? undefined);
	if (!project || !current) return null;
	const persistent = project.environments.filter(environment => environment.kind === 'persistent');
	const previews = project.environments.filter(environment => environment.kind === 'preview');

	const item = (environment: Environment) => (
		<DropdownMenuItem key={environment.id} asChild>
			<Link href={projectHref(projectId, { env: environment.id })}>
				<EnvironmentDot environment={environment} className={environment.kind === 'preview' ? 'size-4' : undefined} />
				<span className="flex-1 truncate">{environment.name}</span>
				<span className="text-xs text-muted-foreground">{environment.serviceCount}</span>
				{environment.id === current.id && <CheckIcon className="size-4" />}
			</Link>
		</DropdownMenuItem>
	);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger className={trigger}>
				<EnvironmentDot environment={current} />
				<span className="max-w-32 truncate">{current.name}</span>
				<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-60">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Environments</DropdownMenuLabel>
				{persistent.map(item)}
				{previews.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="text-xs text-muted-foreground">PR previews</DropdownMenuLabel>
						{previews.map(item)}
					</>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href={`${projectSettingsHref(projectId)}#environments`}>
						<PlusIcon className="size-4" />
						New environment
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const adminSections = [
	{ label: 'Monitoring', href: '/admin/monitoring' },
	{ label: 'Users', href: '/admin/users' },
	{ label: 'Settings', href: '/admin/settings' }
];

export function AdminSwitcher({ pathname }: { pathname: string }) {
	const current = adminSections.find(section => pathname.startsWith(section.href)) ?? adminSections[0]!;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className={trigger}>
				{current.label}
				<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-44">
				{adminSections.map(section => (
					<DropdownMenuItem key={section.href} asChild>
						<Link href={section.href}>
							<span className="flex-1">{section.label}</span>
							{section === current && <CheckIcon className="size-4" />}
						</Link>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
