'use client';

import {
	ArrowLeftIcon,
	ChevronRightIcon,
	GitPullRequestIcon,
	LayersIcon,
	PencilIcon,
	PlusIcon,
	SettingsIcon,
	Trash2Icon,
	TriangleAlertIcon
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-provider';
import { CopyButton } from '@/components/copy-button';
import { Field } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { SettingsCard, SettingsLayout, type Section } from '@/components/settings-layout';
import { Count, DangerRow, EmptyRow, InfoItem, ListCard, RowIcon, useHashSection, WithTooltip } from '@/components/settings/parts';
import { SaveBar, useDraft } from '@/components/settings/save-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TeamAvatar } from '@/features/shell/avatars';
import { useTeams } from '@/features/team/use-teams';
import { errorCode } from '@/lib/api/api-error';
import type { Environment, ProjectDetail } from '@/lib/api/types';
import { formatRelative } from '@/lib/format';
import { projectHref } from '@/lib/routes';
import { cn } from '@/lib/utils';
import {
	useCreateEnvironment,
	useDeleteEnvironment,
	useDeleteProject,
	useProject,
	useRenameEnvironment,
	useSetPrPreviews,
	useUpdateProject
} from './use-project';

const SECTION_IDS = ['general', 'environments', 'previews', 'danger'];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const PREVIEW_STEPS = [
	{ title: 'Open a pull request', body: 'kubwave clones the base environment and builds the PR branch for its repo-backed services.' },
	{ title: 'Push to update', body: 'Every push to the PR branch redeploys the preview.' },
	{ title: 'Merge or close to clean up', body: 'The preview environment, its volumes and domains are deleted automatically.' }
];

export function ProjectSettings({ projectId }: { projectId: string }) {
	const { data: project, isError } = useProject(projectId);
	if (isError && !project)
		return (
			<div className="mx-auto w-full max-w-5xl px-6 py-16 text-center">
				<p className="text-sm text-muted-foreground">This project is no longer available.</p>
				<Button asChild variant="outline" size="sm" className="mt-4">
					<Link href="/">Back to projects</Link>
				</Button>
			</div>
		);
	if (!project)
		return (
			<div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8">
				<Skeleton className="h-12 w-72" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	return <ProjectSettingsView project={project} />;
}

function ProjectSettingsView({ project }: { project: ProjectDetail }) {
	const [section, setSection] = useHashSection(SECTION_IDS);
	const persistent = project.environments.filter(environment => environment.kind === 'persistent');
	const previews = project.environments.filter(environment => environment.kind === 'preview');
	const previewBase = persistent.find(environment => environment.prPreviewsEnabled) ?? null;

	const sections: Section[] = [
		{ id: 'general', label: 'General', icon: SettingsIcon },
		{ id: 'environments', label: 'Environments', icon: LayersIcon, badge: <Count n={project.environments.length} /> },
		{
			id: 'previews',
			label: 'PR previews',
			icon: GitPullRequestIcon,
			badge: previewBase && (
				<span className="size-1.5 rounded-full bg-success">
					<span className="sr-only">Enabled</span>
				</span>
			)
		},
		{ id: 'danger', label: 'Danger zone', icon: TriangleAlertIcon }
	];

	return (
		<div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8">
			<PageHeader
				eyebrow={
					<span className="flex items-center gap-1.5">
						<Link href={projectHref(project.id)} className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground">
							<ArrowLeftIcon className="size-3" />
							{project.name}
						</Link>
						<ChevronRightIcon className="size-3" />
						Settings
					</span>
				}
				title="Project settings"
				description={project.description || undefined}
			/>
			<SettingsLayout sections={sections} active={section} onChange={setSection}>
				{section === 'general' && <GeneralSection project={project} previewBase={previewBase} />}
				{section === 'environments' && (
					<EnvironmentsSection
						project={project}
						persistent={persistent}
						previews={previews}
						previewBase={previewBase}
						onEnablePreviews={() => setSection('previews')}
					/>
				)}
				{section === 'previews' && (
					<PreviewsSection
						key={previewBase?.id ?? 'off'}
						project={project}
						persistent={persistent}
						previewBase={previewBase}
						previewCount={previews.length}
					/>
				)}
				{section === 'danger' && <DangerSection project={project} />}
			</SettingsLayout>
		</div>
	);
}

function GeneralSection({ project, previewBase }: { project: ProjectDetail; previewBase: Environment | null }) {
	const general = useDraft({ name: project.name, description: project.description });
	const update = useUpdateProject(project);
	const { teams } = useTeams();
	const team = teams.find(candidate => candidate.id === project.teamId);
	const nameError = general.draft.name.trim() ? undefined : 'Enter a project name.';

	const save = async () => {
		if (nameError) return;
		try {
			await update.mutateAsync({ name: general.draft.name.trim(), description: general.draft.description.trim() });
			general.save();
			toast.success('Project saved');
		} catch (err) {
			toast.error(errorCode(err) === 'project_name_taken' ? 'A project with that name already exists.' : 'Could not save project.');
		}
	};

	return (
		<>
			<SettingsCard title="General" description="Shown in the project switcher and on the dashboard.">
				<div className="grid gap-4">
					<Field
						id="project-name"
						label="Name"
						maxLength={100}
						value={general.draft.name}
						onChange={event => general.set('name', event.target.value)}
						error={general.changes ? nameError : undefined}
						className="max-w-sm"
					/>
					<div className="grid gap-2">
						<Label htmlFor="project-description">Description</Label>
						<Textarea
							id="project-description"
							maxLength={1000}
							value={general.draft.description}
							onChange={event => general.set('description', event.target.value)}
							placeholder="What runs in this project?"
							className="min-h-20"
						/>
					</div>
				</div>
			</SettingsCard>
			<SettingsCard title="Project info">
				<dl className="grid gap-5 sm:grid-cols-3">
					<InfoItem label="Project ID">
						<code className="truncate font-mono text-xs">{project.id}</code>
						<CopyButton value={project.id} label="Copy project ID" />
					</InfoItem>
					<InfoItem label="Team">
						{team && <TeamAvatar name={team.name} />}
						{team?.name ?? '—'}
					</InfoItem>
					<InfoItem label="Last updated">{formatRelative(project.updatedAt)}</InfoItem>
					<InfoItem label="Environments">{plural(project.environmentCount, 'environment')}</InfoItem>
					<InfoItem label="Services">{plural(project.serviceCount, 'service')}</InfoItem>
					<InfoItem label="PR previews">
						{previewBase ? <span className="text-success">From {previewBase.name}</span> : <span className="text-muted-foreground">Disabled</span>}
					</InfoItem>
				</dl>
			</SettingsCard>
			<SaveBar changes={general.changes} pending={update.isPending} onDiscard={general.discard} onSave={() => void save()} />
		</>
	);
}

function EnvironmentsSection({
	project,
	persistent,
	previews,
	previewBase,
	onEnablePreviews
}: {
	project: ProjectDetail;
	persistent: Environment[];
	previews: Environment[];
	previewBase: Environment | null;
	onEnablePreviews: () => void;
}) {
	const confirm = useConfirm();
	const [dialog, setDialog] = useState<{ environment: Environment | null } | null>(null);
	const remove = useDeleteEnvironment(project);

	const onDelete = async (environment: Environment) => {
		const confirmed = await confirm({
			title: `Delete ${environment.name}?`,
			description: `Deletes ${plural(environment.serviceCount, 'service')} with their volumes, domains and deployment history. This cannot be undone.`,
			destructive: true,
			confirmLabel: 'Delete environment',
			confirmationText: environment.name
		});
		if (!confirmed) return;
		try {
			await remove.mutateAsync(environment.id);
			toast.success(`Environment ${environment.name} deleted`);
		} catch {
			toast.error('Could not delete environment.');
		}
	};

	return (
		<>
			<ListCard
				title="Environments"
				description="Persistent environments run side by side, each with its own services, variables and domains."
				action={
					<Button size="sm" onClick={() => setDialog({ environment: null })}>
						<PlusIcon /> New environment
					</Button>
				}
			>
				{persistent.map(environment => {
					const isBase = previewBase?.id === environment.id;
					const blocked = persistent.length === 1 && 'A project needs at least one persistent environment.';
					return (
						<li key={environment.id} className="flex min-h-15 items-center gap-3 px-5 py-3">
							<RowIcon icon={LayersIcon} />
							<div className="min-w-0 flex-1">
								<p className="flex flex-wrap items-center gap-2">
									<Link href={projectHref(project.id, { env: environment.id })} className="truncate text-sm font-medium hover:underline">
										{environment.name}
									</Link>
									{isBase && (
										<Badge variant="outline" className="px-1.5 text-[10px] text-muted-foreground">
											<GitPullRequestIcon />
											Preview base
										</Badge>
									)}
								</p>
								<p className="text-xs text-muted-foreground">
									{environment.serviceCount ? plural(environment.serviceCount, 'service') : 'No services yet'}
								</p>
							</div>
							<Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setDialog({ environment })}>
								<PencilIcon /> Rename
							</Button>
							<WithTooltip tip={blocked}>
								<Button
									variant="ghost"
									size="icon-sm"
									disabled={Boolean(blocked) || remove.isPending}
									aria-label={`Delete ${environment.name}`}
									className="text-muted-foreground hover:text-destructive"
									onClick={() => void onDelete(environment)}
								>
									<Trash2Icon />
								</Button>
							</WithTooltip>
						</li>
					);
				})}
			</ListCard>

			<ListCard
				title="Pull request previews"
				description="Short-lived environments created from pull requests. They are deleted when the PR is merged or closed."
			>
				{previews.length === 0 && (
					<EmptyRow
						icon={GitPullRequestIcon}
						title="No open previews"
						description={
							previewBase ? (
								'Open a pull request on a repo-backed service to spin one up.'
							) : (
								<>
									PR previews are off for this project.{' '}
									<button type="button" onClick={onEnablePreviews} className="text-primary-text underline-offset-4 hover:underline">
										Enable them
									</button>
								</>
							)
						}
					/>
				)}
				{previews.map(environment => (
					<li key={environment.id} className="flex items-center gap-3 px-5 py-3">
						<RowIcon icon={GitPullRequestIcon} className="text-success" />
						<div className="min-w-0 flex-1">
							<Link href={projectHref(project.id, { env: environment.id })} className="text-sm font-medium hover:underline">
								PR #{environment.prNumber}
							</Link>
							<p className="truncate text-xs text-muted-foreground">
								{environment.serviceCount ? plural(environment.serviceCount, 'service') : 'provisioning'} · opened{' '}
								{formatRelative(environment.createdAt)}
							</p>
						</div>
						{environment.prRepoUrl && environment.prNumber && (
							<Button asChild variant="outline" size="sm">
								<a href={pullRequestUrl(environment.prRepoUrl, environment.prNumber)} target="_blank" rel="noreferrer">
									View PR
								</a>
							</Button>
						)}
					</li>
				))}
			</ListCard>

			<EnvironmentDialog project={project} target={dialog} onClose={() => setDialog(null)} />
		</>
	);
}

const pullRequestUrl = (repoUrl: string, prNumber: number) => `${repoUrl.replace(/\.git$/, '').replace(/\/$/, '')}/pull/${prNumber}`;

// Creates a persistent environment, or renames `target.environment` when set.
function EnvironmentDialog({
	project,
	target,
	onClose
}: {
	project: ProjectDetail;
	target: { environment: Environment | null } | null;
	onClose: () => void;
}) {
	const create = useCreateEnvironment(project);
	const rename = useRenameEnvironment(project);
	const [name, setName] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [openedFor, setOpenedFor] = useState<typeof target>(null);
	if (target !== openedFor) {
		setOpenedFor(target);
		setName(target?.environment?.name ?? '');
		setError(null);
	}
	const existing = target?.environment ?? null;
	const pending = create.isPending || rename.isPending;

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!name.trim()) return setError('Enter an environment name.');
		try {
			if (existing) await rename.mutateAsync({ environmentId: existing.id, name });
			else await create.mutateAsync(name);
			toast.success(existing ? 'Environment renamed' : `Environment ${name.trim()} created`);
			onClose();
		} catch (err) {
			setError(errorCode(err) === 'environment_name_taken' ? 'An environment with that name already exists.' : 'Could not save environment.');
		}
	};

	return (
		<Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={event => void submit(event)} className="grid gap-4" noValidate>
					<DialogHeader>
						<DialogTitle>{existing ? `Rename ${existing.name}` : 'New environment'}</DialogTitle>
						<DialogDescription>
							{existing ? 'Give this environment a new name.' : 'A persistent environment with its own services, variables and domains.'}
						</DialogDescription>
					</DialogHeader>
					<Field
						id="environment-name"
						label="Name"
						autoFocus
						autoComplete="off"
						placeholder="staging"
						maxLength={100}
						value={name}
						onChange={event => {
							setName(event.target.value);
							setError(null);
						}}
						error={error ?? undefined}
					/>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={pending || !name.trim()}>
							{existing ? 'Rename' : 'Create environment'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function PreviewsSection({
	project,
	persistent,
	previewBase,
	previewCount
}: {
	project: ProjectDetail;
	persistent: Environment[];
	previewBase: Environment | null;
	previewCount: number;
}) {
	// Seeded once per saved base (the section is keyed by it), so the 10s project poll never clobbers edits.
	const config = useDraft({ enabled: previewBase !== null, baseEnvironmentId: previewBase?.id ?? persistent[0]?.id ?? '' });
	const setPrPreviews = useSetPrPreviews(project);
	const desired = config.draft.enabled ? config.draft.baseEnvironmentId || null : null;
	const changed = desired !== (previewBase?.id ?? null);

	const save = async () => {
		try {
			await setPrPreviews.mutateAsync(desired);
			toast.success(desired ? 'PR previews enabled' : 'PR previews disabled');
		} catch {
			toast.error('Could not update PR previews.');
		}
	};

	return (
		<SettingsCard
			title="PR previews"
			description="Spin up an isolated copy of an environment for every open pull request on its repo-backed services."
			footer={
				<>
					<p className="mr-auto text-xs text-muted-foreground">Applies to new pull requests. Open previews keep running.</p>
					<Button size="sm" disabled={!changed || setPrPreviews.isPending} onClick={() => void save()}>
						Save
					</Button>
				</>
			}
		>
			<div className="space-y-6">
				<div className="flex items-start justify-between gap-4 rounded-md border p-4">
					<div className="space-y-1.5">
						<Label htmlFor="previews-enabled">Enable PR previews</Label>
						<p className="text-sm text-muted-foreground">
							Repo-backed services are rebuilt from the PR branch. Databases and images are cloned as they are.
						</p>
					</div>
					<Switch
						id="previews-enabled"
						checked={config.draft.enabled}
						disabled={persistent.length === 0}
						onCheckedChange={enabled => config.set('enabled', enabled)}
					/>
				</div>
				<div className={cn('grid gap-2 transition-opacity', !config.draft.enabled && 'opacity-60')}>
					<Label htmlFor="previews-base">Base environment</Label>
					<Select value={config.draft.baseEnvironmentId} onValueChange={id => config.set('baseEnvironmentId', id)} disabled={!config.draft.enabled}>
						<SelectTrigger id="previews-base" className="w-full sm:w-64">
							<SelectValue placeholder="Select an environment" />
						</SelectTrigger>
						<SelectContent>
							{persistent.map(environment => (
								<SelectItem key={environment.id} value={environment.id}>
									{environment.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">Previews copy its services, variables and config files, with public hosts rewritten per PR.</p>
				</div>
				<div className="space-y-3">
					<p className="text-sm font-medium">How previews work</p>
					<ol className="list-decimal space-y-2 pl-5 text-sm marker:text-muted-foreground">
						{PREVIEW_STEPS.map(step => (
							<li key={step.title}>
								<span className="font-medium">{step.title}.</span> <span className="text-muted-foreground">{step.body}</span>
							</li>
						))}
					</ol>
				</div>
				<p className="text-xs text-muted-foreground">
					{plural(previewCount, 'preview')} open. Instance admins set the concurrent preview limit in platform settings.
				</p>
			</div>
		</SettingsCard>
	);
}

function DangerSection({ project }: { project: ProjectDetail }) {
	const router = useRouter();
	const confirm = useConfirm();
	const remove = useDeleteProject(project);

	const onDelete = async () => {
		const confirmed = await confirm({
			title: `Delete ${project.name}?`,
			description: 'Everything in this project is deleted from the cluster, including volumes and their data. This cannot be undone.',
			destructive: true,
			confirmLabel: 'Delete project',
			confirmationText: project.name
		});
		if (!confirmed) return;
		try {
			await remove.mutateAsync(undefined);
			toast.success(`Project ${project.name} deleted`);
			router.push('/');
		} catch {
			toast.error('Could not delete project.');
		}
	};

	return (
		<SettingsCard title="Danger zone" tone="danger">
			<DangerRow
				title="Delete project"
				description={`Permanently deletes ${plural(project.environmentCount, 'environment')} with all services, volumes, domains and deployments.`}
			>
				<Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => void onDelete()}>
					<Trash2Icon /> Delete project
				</Button>
			</DangerRow>
		</SettingsCard>
	);
}
