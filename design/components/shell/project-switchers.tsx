'use client';

import { CheckIcon, ChevronsUpDownIcon, GitPullRequestIcon, LayersIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { getProject, projects } from '@/lib/mock';
import { useAppState } from './app-state';

const trigger =
	'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring';

export function useCurrentEnv(projectId: string) {
	const { envByProject } = useAppState();
	const project = getProject(projectId);
	const envId = envByProject[projectId] ?? project?.environments[0]?.id;
	return project?.environments.find(e => e.id === envId) ?? project?.environments[0];
}

export function ProjectSwitcher({ projectId }: { projectId: string }) {
	const router = useRouter();
	const project = getProject(projectId);
	if (!project) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className={trigger}>
				<span className="max-w-40 truncate">{project.name}</span>
				<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
				{projects
					.filter(p => p.teamId === project.teamId)
					.map(p => (
						<DropdownMenuItem key={p.id} onSelect={() => router.push(`/project/${p.id}`)}>
							<LayersIcon className="size-4 text-muted-foreground" />
							<span className="flex-1 truncate">{p.name}</span>
							{p.id === projectId && <CheckIcon className="size-4" />}
						</DropdownMenuItem>
					))}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href={`/project/${projectId}/settings`}>
						<SettingsIcon className="size-4" />
						Project settings
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const adminSections = [
	{ label: 'Cluster', href: '/admin/cluster' },
	{ label: 'Users', href: '/admin/users' },
	{ label: 'Settings', href: '/admin/settings' }
];

export function AdminSwitcher({ pathname }: { pathname: string }) {
	const current = adminSections.find(s => pathname.startsWith(s.href)) ?? adminSections[0]!;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className={trigger}>
				{current.label}
				<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-44">
				{adminSections.map(s => (
					<DropdownMenuItem key={s.href} asChild>
						<Link href={s.href}>
							<span className="flex-1">{s.label}</span>
							{s === current && <CheckIcon className="size-4" />}
						</Link>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function EnvSwitcher({ projectId }: { projectId: string }) {
	const { setEnv } = useAppState();
	const router = useRouter();
	const project = getProject(projectId);
	const current = useCurrentEnv(projectId);
	if (!project || !current) return null;
	const persistent = project.environments.filter(e => e.kind === 'persistent');
	const previews = project.environments.filter(e => e.kind === 'preview');
	const select = (id: string) => {
		setEnv(projectId, id);
		router.push(`/project/${projectId}`);
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className={trigger}>
				{current.kind === 'preview' ? (
					<GitPullRequestIcon className="size-3.5 text-primary-text" />
				) : (
					<span className={`size-2 rounded-full ${current.name === 'production' ? 'bg-success' : 'bg-warning'}`} />
				)}
				<span className="max-w-32 truncate">{current.name}</span>
				<ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-60">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Environments</DropdownMenuLabel>
				{persistent.map(e => (
					<DropdownMenuItem key={e.id} onSelect={() => select(e.id)}>
						<span className={`size-2 rounded-full ${e.name === 'production' ? 'bg-success' : 'bg-warning'}`} />
						<span className="flex-1">{e.name}</span>
						<span className="text-xs text-muted-foreground">{e.services.length}</span>
						{e.id === current.id && <CheckIcon className="size-4" />}
					</DropdownMenuItem>
				))}
				{previews.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="text-xs text-muted-foreground">PR previews</DropdownMenuLabel>
						{previews.map(e => (
							<DropdownMenuItem key={e.id} onSelect={() => select(e.id)}>
								<GitPullRequestIcon className="size-4 text-primary-text" />
								<span className="flex-1">{e.name}</span>
								<span className="text-xs text-muted-foreground">{e.services.length}</span>
								{e.id === current.id && <CheckIcon className="size-4" />}
							</DropdownMenuItem>
						))}
					</>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href={`/project/${projectId}/settings`}>
						<PlusIcon className="size-4" />
						New environment
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
