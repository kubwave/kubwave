'use client';

import { LayoutGridIcon, LayoutTemplateIcon, ListIcon, PlusIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProjectCard, ProjectList, productionServices } from '@/components/home/project-views';
import { PageHeader } from '@/components/page-header';
import { useAppState } from '@/components/shell/app-state';
import { deploymentStyles, StatusDot } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { activity, type Project, projects as mockProjects, teams, templates } from '@/lib/mock';
import { cn } from '@/lib/utils';

type Template = (typeof templates)[number];

function TemplateMenu({ onPick, children }: { onPick: (t: Template) => void; children: React.ReactNode }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Deploy a template</DropdownMenuLabel>
				{templates.map(t => (
					<DropdownMenuItem key={t.id} onSelect={() => onPick(t)} className="py-2">
						<span className="min-w-0">
							<span className="block text-sm">{t.name}</span>
							<span className="block text-xs text-muted-foreground">{t.description}</span>
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function EmptyProjects({ team, onCreate, onTemplate }: { team: string; onCreate: () => void; onTemplate: (t: Template) => void }) {
	return (
		<div className="rounded-lg border border-dashed px-6 py-14 text-center">
			<h2 className="font-medium">No projects in {team}</h2>
			<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">A project holds the services, databases and environments of one app.</p>
			<div className="mt-5 flex flex-wrap justify-center gap-2">
				<Button size="sm" onClick={onCreate}>
					<PlusIcon />
					New project
				</Button>
				<TemplateMenu onPick={onTemplate}>
					<Button size="sm" variant="outline">
						<LayoutTemplateIcon />
						From template
					</Button>
				</TemplateMenu>
			</div>
		</div>
	);
}

export default function HomePage() {
	const { teamId } = useAppState();
	const team = teams.find(t => t.id === teamId)!;
	const [created, setCreated] = useState<Project[]>([]);
	const [query, setQuery] = useState('');
	const [sort, setSort] = useState<'recent' | 'name'>('recent');
	const [view, setView] = useState<'grid' | 'list'>('grid');
	const [dialogOpen, setDialogOpen] = useState(false);

	const teamProjects = [...created, ...mockProjects].filter(p => p.teamId === teamId);
	const q = query.trim().toLowerCase();
	const matches = teamProjects.filter(
		p => !q || p.name.includes(q) || p.description.toLowerCase().includes(q) || productionServices(p).some(s => s.name.includes(q))
	);
	const visible = sort === 'name' ? [...matches].sort((a, b) => a.name.localeCompare(b.name)) : matches;

	const feed = activity.filter(a => teamProjects.some(p => p.id === a.project));

	const addProject = (rawName: string, description: string) => {
		const name = rawName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
		if (!name) return null;
		if (teamProjects.some(p => p.id === name)) {
			toast.error(`A project named ${name} already exists`);
			return null;
		}
		const project: Project = {
			id: name,
			teamId,
			name,
			description,
			updatedAgo: 'just now',
			prPreviews: false,
			environments: [{ id: 'production', name: 'production', kind: 'persistent', services: [] }]
		};
		setCreated(c => [project, ...c]);
		return name;
	};

	const deployTemplate = (t: Template) => {
		if (addProject(t.id, t.description)) toast.success(`Deploying ${t.name}`, { description: 'Preview only — nothing was deployed.' });
	};

	const submitNewProject = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const name = addProject(String(form.get('name')), String(form.get('description')).trim());
		if (!name) return;
		toast.success(`Project ${name} created`, { description: 'Preview only — nothing was saved.' });
		setDialogOpen(false);
	};

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-8">
			<PageHeader
				title="Projects"
				actions={
					<>
						<TemplateMenu onPick={deployTemplate}>
							<Button variant="outline" size="sm">
								<LayoutTemplateIcon />
								Templates
							</Button>
						</TemplateMenu>
						<Button size="sm" onClick={() => setDialogOpen(true)}>
							<PlusIcon />
							New project
						</Button>
					</>
				}
			/>

			<div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
				<section aria-labelledby="projects-heading" className="min-w-0">
					<div className="mb-4 flex flex-wrap items-center gap-2">
						<h2 id="projects-heading" className="sr-only">
							Projects
						</h2>
						{teamProjects.length > 0 && (
							<>
								<div className="relative mr-auto w-full sm:w-64">
									<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
									<Input
										type="search"
										aria-label="Search projects"
										placeholder="Search projects…"
										value={query}
										onChange={e => setQuery(e.target.value)}
										className="h-8 pl-8"
									/>
								</div>
								<Select value={sort} onValueChange={v => setSort(v as typeof sort)}>
									<SelectTrigger size="sm" className="w-40" aria-label="Sort projects">
										<SelectValue />
									</SelectTrigger>
									<SelectContent position="popper" align="end">
										<SelectItem value="recent">Recently updated</SelectItem>
										<SelectItem value="name">Name</SelectItem>
									</SelectContent>
								</Select>
								<ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={v => v && setView(v as typeof view)}>
									<ToggleGroupItem value="grid" aria-label="Grid view">
										<LayoutGridIcon />
									</ToggleGroupItem>
									<ToggleGroupItem value="list" aria-label="List view">
										<ListIcon />
									</ToggleGroupItem>
								</ToggleGroup>
							</>
						)}
					</div>

					{teamProjects.length === 0 ? (
						<EmptyProjects team={team.name} onCreate={() => setDialogOpen(true)} onTemplate={deployTemplate} />
					) : visible.length === 0 ? (
						<div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
							No projects match <span className="font-mono text-foreground">{query}</span>.{' '}
							<button type="button" className="text-foreground underline-offset-4 hover:underline" onClick={() => setQuery('')}>
								Clear search
							</button>
						</div>
					) : view === 'grid' ? (
						<div className="grid gap-3 md:grid-cols-2">
							{visible.map(p => (
								<ProjectCard key={p.id} project={p} />
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
					{feed.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing deployed in {team.name} yet.</p>
					) : (
						<ol className="-mx-2">
							{feed.map(a => (
								<li key={a.id}>
									<Link
										href={`/project/${a.project}`}
										className="flex items-baseline gap-2.5 rounded-md px-2 py-2 outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
									>
										<StatusDot className={cn('size-1.5 -translate-y-px', deploymentStyles[a.status].dot)} />
										<span className="min-w-0 flex-1">
											<span className="flex items-baseline gap-2 text-sm">
												<span className="font-medium">{a.service}</span>
												<span className="truncate text-xs text-muted-foreground">
													{a.project}/{a.env}
												</span>
												<span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{a.ago}</span>
											</span>
											<span className={cn('block truncate text-xs', a.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
												{a.message}
											</span>
										</span>
									</Link>
								</li>
							))}
						</ol>
					)}
				</aside>
			</div>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-md">
					<form onSubmit={submitNewProject} className="grid gap-5">
						<DialogHeader>
							<DialogTitle>New project</DialogTitle>
							<DialogDescription>Projects group services that ship together. It starts with a production environment.</DialogDescription>
						</DialogHeader>
						<div className="grid gap-2">
							<Label htmlFor="project-name">Name</Label>
							<Input id="project-name" name="name" placeholder="my-app" className="font-mono" required autoFocus autoComplete="off" />
						</div>
						<div className="grid gap-2">
							<Label htmlFor="project-description">
								Description <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Textarea id="project-description" name="description" rows={3} placeholder="What does this project run?" />
						</div>
						<DialogFooter>
							<Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit">Create project</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
