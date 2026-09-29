'use client';

import { apiData, type TeamDeploymentsListResponse } from '@kubwave/api-client';
import { useQuery } from '@tanstack/react-query';
import { LayoutGridIcon, ListIcon, PlusIcon, SearchIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { LoadError } from '@/components/settings/parts';
import { deploymentStyles, StatusDot } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CreateProjectDialog } from '@/features/project/create-project-dialog';
import { useTeamProjects, type ProjectListItem } from '@/features/project/use-project';
import { useShellState } from '@/features/shell/shell-state';
import { useTeams } from '@/features/team/use-teams';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { formatRelative } from '@/lib/format';
import { projectHref } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { visibleProjects, type ProjectSort } from './model';

type TeamDeployment = TeamDeploymentsListResponse[number];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Deploys also run out-of-band (auto-deploy, previews), so the feed polls instead of relying on invalidation.
function useTeamDeployments(teamId: string | null) {
	return useQuery({
		queryKey: queryKeys.teamDeployments(teamId ?? 'none'),
		queryFn: () => apiData(getBrowserApi().teams(teamId!).deployments.get()),
		enabled: Boolean(teamId),
		refetchInterval: 15_000
	});
}

function ProjectCard({ project }: { project: ProjectListItem }) {
	return (
		<Link
			href={projectHref(project.id)}
			className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="flex items-baseline gap-3">
				<h3 className="truncate font-medium">{project.name}</h3>
				<span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatRelative(project.updatedAt)}</span>
			</div>
			<p className="-mt-2 line-clamp-1 text-sm text-muted-foreground">{project.description || 'No description'}</p>
			<div className="mt-auto flex items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
				<span>{plural(project.serviceCount, 'service')}</span>
				<span className="ml-auto">{plural(project.environmentCount, 'environment')}</span>
			</div>
		</Link>
	);
}

function ProjectList({ projects }: { projects: ProjectListItem[] }) {
	const cols = 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_6rem_7rem_6rem]';
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<div className={cn('hidden items-center gap-4 border-b px-4 py-2 text-xs text-muted-foreground md:grid', cols)}>
				<span>Project</span>
				<span>Services</span>
				<span>Environments</span>
				<span className="text-right">Updated</span>
			</div>
			<ul className="divide-y">
				{projects.map(project => (
					<li key={project.id}>
						<Link
							href={projectHref(project.id)}
							className={cn('grid items-center gap-4 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:bg-accent/40', cols)}
						>
							<div className="min-w-0">
								<div className="truncate text-sm font-medium">{project.name}</div>
								<div className="truncate text-xs text-muted-foreground">{project.description || 'No description'}</div>
							</div>
							<span className="hidden text-xs text-muted-foreground tabular-nums md:block">{project.serviceCount}</span>
							<span className="hidden text-xs text-muted-foreground tabular-nums md:block">{project.environmentCount}</span>
							<span className="text-right text-xs text-muted-foreground tabular-nums">{formatRelative(project.updatedAt)}</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

function DeploymentFeed({ teamId, teamName }: { teamId: string; teamName: string }) {
	const { data: deployments, isPending, isError, refetch } = useTeamDeployments(teamId);
	if (isPending) return <Skeleton className="h-24 w-full" />;
	if (isError && !deployments) return <LoadError what="recent deployments" onRetry={() => void refetch()} />;
	if (!deployments?.length) return <p className="text-sm text-muted-foreground">Nothing deployed in {teamName} yet.</p>;
	return (
		<ol className="-mx-2">
			{deployments.map((deployment: TeamDeployment) => (
				<li key={deployment.id}>
					<Link
						href={projectHref(deployment.projectId, { env: deployment.environmentId, service: deployment.serviceId })}
						className="flex items-baseline gap-2.5 rounded-md px-2 py-2 outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
					>
						<StatusDot className={cn('size-1.5 -translate-y-px', deploymentStyles[deployment.status].dot)} />
						<span className="min-w-0 flex-1">
							<span className="flex items-baseline gap-2 text-sm">
								<span className="font-medium">{deployment.serviceName}</span>
								<span className="truncate text-xs text-muted-foreground">
									{deployment.projectName}/{deployment.environmentName}
								</span>
								<span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatRelative(deployment.createdAt)}</span>
							</span>
							<span className={cn('block truncate text-xs', deployment.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
								{deploymentStyles[deployment.status].label} · {deployment.trigger} deploy
							</span>
						</span>
					</Link>
				</li>
			))}
		</ol>
	);
}

function NoTeam() {
	const { setCreateTeamOpen } = useShellState();
	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-8">
			<div className="rounded-lg border border-dashed px-6 py-14 text-center">
				<UsersIcon className="mx-auto size-5 text-muted-foreground" />
				<h2 className="mt-3 font-medium">You are not in a team yet</h2>
				<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Teams own projects. Create one, or ask a team owner to add you.</p>
				<Button size="sm" className="mt-5" onClick={() => setCreateTeamOpen(true)}>
					<PlusIcon />
					Create team
				</Button>
			</div>
		</div>
	);
}

export function HomePage() {
	const { activeTeam, isPending: teamsPending, isError: teamsFailed, refetch: refetchTeams } = useTeams();
	const { data: projects = [], isPending, isError: projectsFailed, refetch: refetchProjects } = useTeamProjects(activeTeam?.id ?? null);
	const [query, setQuery] = useState('');
	const [sort, setSort] = useState<ProjectSort>('recent');
	const [view, setView] = useState<'grid' | 'list'>('grid');
	const [createOpen, setCreateOpen] = useState(false);

	if (teamsPending) return null;
	if (!activeTeam && teamsFailed)
		return (
			<div className="mx-auto w-full max-w-6xl px-6 py-8">
				<LoadError what="your teams" onRetry={() => void refetchTeams()} className="rounded-lg border" />
			</div>
		);
	if (!activeTeam) return <NoTeam />;
	const visible = visibleProjects(projects, query, sort);

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-8">
			<PageHeader
				title="Projects"
				actions={
					<Button size="sm" onClick={() => setCreateOpen(true)}>
						<PlusIcon />
						New project
					</Button>
				}
			/>

			<div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
				<section aria-label="Projects" className="min-w-0">
					{projects.length > 0 && (
						<div className="mb-4 flex flex-wrap items-center gap-2">
							<div className="relative mr-auto w-full sm:w-64">
								<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
								<Input
									type="search"
									aria-label="Search projects"
									placeholder="Search projects…"
									value={query}
									onChange={event => setQuery(event.target.value)}
									className="h-8 pl-8"
								/>
							</div>
							<Select value={sort} onValueChange={value => setSort(value as ProjectSort)}>
								<SelectTrigger size="sm" className="w-40" aria-label="Sort projects">
									<SelectValue />
								</SelectTrigger>
								<SelectContent position="popper" align="end">
									<SelectItem value="recent">Recently updated</SelectItem>
									<SelectItem value="name">Name</SelectItem>
								</SelectContent>
							</Select>
							<ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={value => value && setView(value as typeof view)}>
								<ToggleGroupItem value="grid" aria-label="Grid view">
									<LayoutGridIcon />
								</ToggleGroupItem>
								<ToggleGroupItem value="list" aria-label="List view">
									<ListIcon />
								</ToggleGroupItem>
							</ToggleGroup>
						</div>
					)}

					{isPending ? (
						<div className="grid gap-3 md:grid-cols-2">
							<Skeleton className="h-32" />
							<Skeleton className="h-32" />
						</div>
					) : projectsFailed && projects.length === 0 ? (
						<LoadError what="the projects" onRetry={() => void refetchProjects()} className="rounded-lg border" />
					) : projects.length === 0 ? (
						<div className="rounded-lg border border-dashed px-6 py-14 text-center">
							<h2 className="font-medium">No projects in {activeTeam.name}</h2>
							<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
								A project holds the services, databases and environments of one app.
							</p>
							<Button size="sm" className="mt-5" onClick={() => setCreateOpen(true)}>
								<PlusIcon />
								New project
							</Button>
						</div>
					) : visible.length === 0 ? (
						<div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
							No projects match <span className="font-mono text-foreground">{query}</span>.{' '}
							<button type="button" className="text-foreground underline-offset-4 hover:underline" onClick={() => setQuery('')}>
								Clear search
							</button>
						</div>
					) : view === 'grid' ? (
						<div className="grid gap-3 md:grid-cols-2">
							{visible.map(project => (
								<ProjectCard key={project.id} project={project} />
							))}
						</div>
					) : (
						<ProjectList projects={visible} />
					)}
				</section>

				<aside aria-labelledby="activity-heading">
					<h2 id="activity-heading" className="mb-3 text-sm font-medium">
						Recent deployments
					</h2>
					<DeploymentFeed teamId={activeTeam.id} teamName={activeTeam.name} />
				</aside>
			</div>

			<CreateProjectDialog teamId={activeTeam.id} open={createOpen} onOpenChange={setCreateOpen} />
		</div>
	);
}
