'use client';

import {
	ArrowLeftIcon,
	ArrowRightLeftIcon,
	ChevronRightIcon,
	GitBranchIcon,
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
import { Field } from '@/components/auth/auth-kit';
import { ConfirmDelete } from '@/components/confirm-delete';
import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { type Section, SettingsCard, SettingsLayout } from '@/components/settings-layout';
import { TeamAvatar } from '@/components/shell/team-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { type Environment, getProject, teams } from '@/lib/mock';
import { pullRequests } from '@/lib/mock-settings';
import { cn } from '@/lib/utils';
import { Count, DangerRow, EmptyRow, InfoItem, ListCard, RowIcon, useHashSection, WithTooltip } from './parts';
import { SaveBar, useDraft } from './save-bar';

const sectionIds = ['general', 'environments', 'previews', 'danger'];
const previewLimit = 5;

const previewSteps = [
	{
		title: 'Label a pull request',
		body: 'Add the preview label to a PR. kubwave clones the base environment and builds the PR branch.'
	},
	{
		title: 'Push to update',
		body: 'Every push redeploys the preview. A PR comment links to hosts like pr-42-web.preview.acme.dev.'
	},
	{ title: 'Merge or close to clean up', body: 'The preview environment, its volumes and domains are deleted automatically.' }
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ProjectSettings({ projectId }: { projectId: string }) {
	const project = getProject(projectId)!;
	const router = useRouter();
	const [section, setSection] = useHashSection(sectionIds);
	const [envs, setEnvs] = useState(project.environments);
	const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
	const [transferTo, setTransferTo] = useState('');
	const persistent = envs.filter(e => e.kind === 'persistent');
	const previews = envs.filter(e => e.kind === 'preview');
	const general = useDraft({ name: project.name, description: project.description });
	const previewConfig = useDraft({ enabled: project.prPreviews, baseEnv: (persistent.find(e => e.id === 'staging') ?? persistent[0]!).id });
	const team = teams.find(t => t.id === project.teamId)!;
	const name = general.saved.name;

	const envNameError = (value: string, exceptId?: string) =>
		!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(value)
			? 'Use lowercase letters, digits and dashes.'
			: envs.some(e => e.id !== exceptId && e.name === value)
				? 'An environment with this name already exists.'
				: null;
	const renameError = renaming?.value ? envNameError(renaming.value, renaming.id) : null;

	const saveGeneral = () => {
		if (!general.draft.name.trim()) {
			toast.error('Project name cannot be empty');
			return false;
		}
		general.save();
		return true;
	};
	const saveAll = () => {
		if (general.changes && !saveGeneral()) return;
		previewConfig.save();
		toast.success('Project settings saved');
	};
	const commitRename = () => {
		if (!renaming || renameError || !renaming.value) return;
		setEnvs(es => es.map(e => (e.id === renaming.id ? { ...e, name: renaming.value } : e)));
		toast.success(`Environment renamed to ${renaming.value}`);
		setRenaming(null);
	};
	const removeEnv = (env: Environment, message: string, description?: string) => {
		setEnvs(es => es.filter(e => e.id !== env.id));
		toast.success(message, { description });
	};

	const sections: Section[] = [
		{ id: 'general', label: 'General', icon: SettingsIcon },
		{ id: 'environments', label: 'Environments', icon: LayersIcon, badge: <Count n={envs.length} /> },
		{
			id: 'previews',
			label: 'PR previews',
			icon: GitPullRequestIcon,
			badge: previewConfig.saved.enabled && (
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
						<Link href={`/project/${project.id}`} className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground">
							<ArrowLeftIcon className="size-3" />
							{name}
						</Link>
						<ChevronRightIcon className="size-3" />
						Settings
					</span>
				}
				title="Project settings"
				description={general.saved.description}
			/>
			<SettingsLayout sections={sections} active={section} onChange={setSection}>
				{section === 'general' && (
					<>
						<SettingsCard
							title="General"
							description="Shown in the project switcher, on the dashboard and in notifications."
							footer={
								<Button size="sm" disabled={!general.changes} onClick={() => saveGeneral() && toast.success('Project settings saved')}>
									Save
								</Button>
							}
						>
							<div className="grid gap-4">
								<Field
									id="project-name"
									label="Name"
									maxLength={48}
									value={general.draft.name}
									onChange={e => general.set('name', e.target.value)}
									className="max-w-sm"
								/>
								<div className="grid gap-2">
									<div className="flex items-center justify-between gap-2">
										<Label htmlFor="project-description">Description</Label>
										<span className="text-[11px] text-muted-foreground tabular-nums">{general.draft.description.length}/200</span>
									</div>
									<Textarea
										id="project-description"
										maxLength={200}
										value={general.draft.description}
										onChange={e => general.set('description', e.target.value)}
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
									<TeamAvatar name={team.name} />
									{team.name}
								</InfoItem>
								<InfoItem label="Last updated">{project.updatedAgo}</InfoItem>
								<InfoItem label="Environments">
									{persistent.length} persistent
									{previews.length > 0 && <span className="text-muted-foreground">· {plural(previews.length, 'preview')}</span>}
								</InfoItem>
								<InfoItem label="Services">{plural(persistent[0]?.services.length ?? 0, 'service')}</InfoItem>
								<InfoItem label="PR previews">
									{previewConfig.saved.enabled ? (
										<span className="text-success">Enabled</span>
									) : (
										<span className="text-muted-foreground">Disabled</span>
									)}
								</InfoItem>
							</dl>
						</SettingsCard>
					</>
				)}

				{section === 'environments' && (
					<>
						<ListCard
							title="Environments"
							description="Persistent environments run side by side, each with its own services, variables and domains."
							action={
								<NewEnvironmentDialog
									persistent={persistent}
									validate={envNameError}
									onCreate={env => setEnvs(es => [...es.filter(e => e.kind === 'persistent'), env, ...es.filter(e => e.kind === 'preview')])}
								/>
							}
						>
							{persistent.map(env => {
								const isBase = previewConfig.saved.enabled && previewConfig.saved.baseEnv === env.id;
								const blocked =
									persistent.length === 1
										? 'A project needs at least one persistent environment.'
										: isBase && 'This is the PR preview base. Pick another base first.';
								return (
									<li key={env.id} className="flex min-h-15 items-center gap-3 px-5 py-3">
										<RowIcon icon={LayersIcon} />
										{renaming?.id === env.id ? (
											<form
												className="flex flex-1 flex-wrap items-center gap-2"
												onSubmit={e => {
													e.preventDefault();
													commitRename();
												}}
											>
												<Input
													autoFocus
													aria-label={`New name for ${env.name}`}
													value={renaming.value}
													onChange={e => setRenaming({ id: env.id, value: e.target.value.toLowerCase() })}
													onKeyDown={e => e.key === 'Escape' && setRenaming(null)}
													aria-invalid={!!renameError || undefined}
													className="h-8 max-w-56 font-mono"
												/>
												<Button type="submit" size="sm" disabled={!renaming.value || !!renameError}>
													Save
												</Button>
												<Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
													Cancel
												</Button>
												{renameError && <span className="text-xs text-destructive">{renameError}</span>}
											</form>
										) : (
											<>
												<div className="min-w-0 flex-1">
													<p className="flex flex-wrap items-center gap-2">
														<span className="font-mono text-sm font-medium">{env.name}</span>
														{isBase && (
															<Badge variant="outline" className="px-1.5 text-[10px] text-muted-foreground">
																<GitPullRequestIcon />
																Preview base
															</Badge>
														)}
													</p>
													<p className="text-xs text-muted-foreground">
														{env.services.length ? plural(env.services.length, 'service') : 'No services yet'}
													</p>
												</div>
												<Button
													variant="ghost"
													size="sm"
													className="text-muted-foreground"
													onClick={() => setRenaming({ id: env.id, value: env.name })}
												>
													<PencilIcon />
													Rename
												</Button>
												<WithTooltip tip={blocked}>
													{blocked ? (
														<Button variant="ghost" size="icon-sm" disabled aria-label={`Delete ${env.name}`}>
															<Trash2Icon />
														</Button>
													) : (
														<ConfirmDelete
															name={env.name}
															title={`Delete ${env.name}?`}
															description={`Deletes ${plural(env.services.length, 'service')} with their volumes, domains and deployment history. This cannot be undone.`}
															onConfirm={() => removeEnv(env, `Environment ${env.name} deleted`)}
														>
															<Button
																variant="ghost"
																size="icon-sm"
																aria-label={`Delete ${env.name}`}
																className="text-muted-foreground hover:text-destructive"
															>
																<Trash2Icon />
															</Button>
														</ConfirmDelete>
													)}
												</WithTooltip>
											</>
										)}
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
										previewConfig.saved.enabled ? (
											'Add the preview label to a pull request to spin one up.'
										) : (
											<>
												PR previews are off for this project.{' '}
												<button type="button" onClick={() => setSection('previews')} className="text-primary-text underline-offset-4 hover:underline">
													Enable them
												</button>
											</>
										)
									}
								/>
							)}
							{previews.map(env => {
								const pr = pullRequests[env.prNumber!];
								return (
									<li key={env.id} className="flex items-center gap-3 px-5 py-3">
										<RowIcon icon={GitPullRequestIcon} className="text-success" />
										<div className="min-w-0 flex-1">
											<p className="flex min-w-0 items-center gap-2 text-sm">
												<span className="shrink-0 font-medium">PR #{env.prNumber}</span>
												{pr && <span className="truncate text-muted-foreground">{pr.title}</span>}
											</p>
											<p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
												<GitBranchIcon className="size-3 shrink-0" />
												<span className="truncate font-mono">{pr?.branch ?? `pr-${env.prNumber}`}</span>
												<span className="shrink-0">· {env.services.length ? plural(env.services.length, 'service') : 'provisioning'}</span>
												{pr && (
													<span className="hidden shrink-0 sm:inline">
														· opened {pr.opened} by {pr.author}
													</span>
												)}
											</p>
										</div>
										<Button
											variant="outline"
											size="sm"
											onClick={() => removeEnv(env, `Preview for PR #${env.prNumber} closed`, 'Its services, volumes and domains are being deleted.')}
										>
											Close preview
										</Button>
									</li>
								);
							})}
						</ListCard>
					</>
				)}

				{section === 'previews' && (
					<SettingsCard
						title="PR previews"
						description="Spin up an isolated copy of an environment for every labelled pull request."
						footer={
							<>
								<p className="mr-auto text-xs text-muted-foreground">Applies to new pull requests. Open previews keep running.</p>
								<Button
									size="sm"
									disabled={!previewConfig.changes}
									onClick={() => {
										previewConfig.save();
										toast.success(previewConfig.draft.enabled ? 'PR previews enabled' : 'PR previews disabled');
									}}
								>
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
										Repo-backed services (GitHub, Gitea) are rebuilt from the PR branch. Databases and images are cloned as they are.
									</p>
								</div>
								<Switch id="previews-enabled" checked={previewConfig.draft.enabled} onCheckedChange={v => previewConfig.set('enabled', v)} />
							</div>

							<div className={cn('grid gap-2 transition-opacity', !previewConfig.draft.enabled && 'opacity-60')}>
								<Label htmlFor="previews-base">Base environment</Label>
								<Select
									value={previewConfig.draft.baseEnv}
									onValueChange={v => previewConfig.set('baseEnv', v)}
									disabled={!previewConfig.draft.enabled}
								>
									<SelectTrigger id="previews-base" className="w-full font-mono sm:w-64">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{persistent.map(e => (
											<SelectItem key={e.id} value={e.id} className="font-mono">
												{e.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-xs text-muted-foreground">
									Previews copy its services, variables and config files, with public hosts rewritten per PR.
								</p>
							</div>

							<div className="space-y-3">
								<p className="text-sm font-medium">How previews work</p>
								<ol className="list-decimal space-y-2 pl-5 text-sm marker:text-muted-foreground">
									{previewSteps.map(step => (
										<li key={step.title}>
											<span className="font-medium">{step.title}.</span> <span className="text-muted-foreground">{step.body}</span>
										</li>
									))}
								</ol>
							</div>

							<div className="rounded-md border bg-muted/30 p-3">
								<div className="flex items-center justify-between text-xs">
									<span className="font-medium">Concurrent previews</span>
									<span className="font-mono text-muted-foreground tabular-nums">
										{previews.length} / {previewLimit}
									</span>
								</div>
								<Progress value={(previews.length / previewLimit) * 100} className="mt-2 h-1.5" aria-label="Concurrent previews" />
								<p className="mt-2 text-xs text-muted-foreground">
									At the limit, newly labelled PRs wait until a preview closes. Instance admins can raise the limit in cluster settings.
								</p>
							</div>
						</div>
					</SettingsCard>
				)}

				{section === 'danger' && (
					<SettingsCard title="Danger zone" tone="danger">
						<div className="divide-y">
							<DangerRow title="Transfer project" description="Move the project with all environments and services to another team you own.">
								<Select value={transferTo} onValueChange={setTransferTo}>
									<SelectTrigger size="sm" className="w-40" aria-label="Target team">
										<SelectValue placeholder="Select team" />
									</SelectTrigger>
									<SelectContent>
										{teams
											.filter(t => t.id !== project.teamId)
											.map(t => (
												<SelectItem key={t.id} value={t.id} disabled={t.role !== 'owner'}>
													<TeamAvatar name={t.name} />
													{t.name}
													{t.role !== 'owner' && <span className="text-xs text-muted-foreground">member</span>}
												</SelectItem>
											))}
									</SelectContent>
								</Select>
								<Button
									variant="outline"
									size="sm"
									disabled={!transferTo}
									onClick={() => {
										toast.success(`${name} transferred to ${teams.find(t => t.id === transferTo)!.name}`, {
											description: 'Preview only — nothing was moved.'
										});
										setTransferTo('');
									}}
								>
									<ArrowRightLeftIcon />
									Transfer
								</Button>
							</DangerRow>
							<DangerRow
								title="Delete project"
								description={`Permanently deletes ${plural(envs.length, 'environment')} with all services, volumes, domains and deployments.`}
							>
								<ConfirmDelete
									name={name}
									title={`Delete ${name}?`}
									description="Everything in this project is deleted from the cluster, including volumes and their data. This cannot be undone."
									onConfirm={() => {
										toast.success(`Project ${name} deleted`, { description: 'Preview only — nothing was deleted.' });
										router.push('/');
									}}
								>
									<Button variant="destructive" size="sm">
										<Trash2Icon />
										Delete project
									</Button>
								</ConfirmDelete>
							</DangerRow>
						</div>
					</SettingsCard>
				)}
			</SettingsLayout>
			<SaveBar
				changes={general.changes + previewConfig.changes}
				onDiscard={() => {
					general.discard();
					previewConfig.discard();
				}}
				onSave={saveAll}
			/>
		</div>
	);
}

function NewEnvironmentDialog({
	persistent,
	validate,
	onCreate
}: {
	persistent: Environment[];
	validate: (name: string) => string | null;
	onCreate: (env: Environment) => void;
}) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const [source, setSource] = useState('none');
	const error = name ? validate(name) : null;

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const from = persistent.find(env => env.id === source);
		onCreate({ id: `env-${Date.now()}`, name, kind: 'persistent', services: from?.services ?? [] });
		toast.success(`Environment ${name} created`, {
			description: from ? `${plural(from.services.length, 'service')} copied from ${from.name}. Deploy them to go live.` : undefined
		});
		setOpen(false);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={o => {
				setOpen(o);
				if (!o) return;
				setName('');
				setSource('none');
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm">
					<PlusIcon />
					New environment
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit} className="grid gap-4">
					<DialogHeader>
						<DialogTitle>New environment</DialogTitle>
						<DialogDescription>A persistent environment with its own services, variables and domains.</DialogDescription>
					</DialogHeader>
					<Field
						id="env-name"
						label="Name"
						required
						autoFocus
						autoComplete="off"
						placeholder="qa"
						value={name}
						onChange={e => setName(e.target.value.toLowerCase())}
						aria-invalid={!!error || undefined}
						className="font-mono"
						hint={
							<p className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
								{error ?? 'Lowercase letters, digits and dashes.'}
							</p>
						}
					/>
					<div className="grid gap-2">
						<Label htmlFor="env-source">Copy services from</Label>
						<Select value={source} onValueChange={setSource}>
							<SelectTrigger id="env-source" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">Nothing — start empty</SelectItem>
								{persistent.map(env => (
									<SelectItem key={env.id} value={env.id}>
										<span className="font-mono">{env.name}</span>
										<span className="text-xs text-muted-foreground">{plural(env.services.length, 'service')}</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">Copies service configuration and variables. Volume data is not copied.</p>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={!name || !!error}>
							Create environment
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
