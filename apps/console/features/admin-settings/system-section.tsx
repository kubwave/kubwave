'use client';

import { useQuery } from '@tanstack/react-query';
import {
	CircleArrowUpIcon,
	CircleCheckIcon,
	DownloadIcon,
	ExternalLinkIcon,
	FileTextIcon,
	PackageCheckIcon,
	RefreshCwIcon,
	RocketIcon
} from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/confirm-provider';
import { EmptyRow, ListCard } from '@/components/settings/parts';
import { SettingsCard } from '@/components/settings-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatDuration, formatRelative, formatUptime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isNewerVersion } from '@/lib/versions';
import { updateSummary } from './model';
import { UpdateProgressDialog } from './update-progress-dialog';
import { updateRunStatusMeta, updateRunTitle, type UpdateRun } from './update-runs';
import { healthQuery, updateRunsQuery, useCheckForUpdates, useTriggerUpdate, versionQuery } from './use-system';

export function SystemSection() {
	const version = useQuery(versionQuery).data;
	const health = useQuery(healthQuery).data;
	const runs = useQuery(updateRunsQuery).data ?? [];
	const check = useCheckForUpdates();
	const trigger = useTriggerUpdate();
	const confirm = useConfirm();
	const [progress, setProgress] = useState<{ runId: string; autoReload: boolean } | null>(null);
	const [progressOpen, setProgressOpen] = useState(false);
	const { available, latest, changelogUrl } = updateSummary(version);
	const current = version?.currentVersion ?? null;

	const showProgress = (runId: string, autoReload: boolean) => {
		setProgress({ runId, autoReload });
		setProgressOpen(true);
	};

	const startUpdate = async (target: string) => {
		const confirmed = await confirm({
			title: 'Update platform',
			description: `Update the platform${current ? ` from ${current}` : ''} to ${target}? The console will be briefly unavailable while the update runs.`,
			confirmLabel: `Update to ${target}`
		});
		if (confirmed) trigger.mutate(target, { onSuccess: run => showProgress(run.id, true) });
	};

	return (
		<>
			<section className="overflow-hidden rounded-lg border bg-card">
				<div className="flex flex-wrap items-start gap-4 p-5">
					<div className="min-w-0 flex-1 space-y-1">
						<h2 className="flex items-center gap-2 text-base font-semibold">
							{available ? <CircleArrowUpIcon className="size-4 text-info" /> : <CircleCheckIcon className="size-4 text-success" />}
							{available ? (
								<>
									Update available: <span className="font-mono">{latest}</span>
								</>
							) : (
								'kubwave is up to date'
							)}
						</h2>
						<p className="text-sm text-muted-foreground">
							{available ? `Version ${latest} is ready to install.` : `You're running the latest release${current ? `, ${current}` : ''}.`}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{changelogUrl && (
							<Button variant="outline" size="sm" asChild>
								<a href={changelogUrl} target="_blank" rel="noreferrer">
									Changelog
									<ExternalLinkIcon />
								</a>
							</Button>
						)}
						{available && latest && (
							<Button size="sm" disabled={trigger.isPending} onClick={() => void startUpdate(latest)}>
								<RocketIcon />
								Update to {latest}
							</Button>
						)}
					</div>
				</div>
				<dl className="grid grid-cols-3 divide-x border-t">
					<div className="space-y-0.5 px-5 py-3">
						<dt className="text-xs text-muted-foreground">Installed</dt>
						<dd className="truncate font-mono text-sm">{current ?? '—'}</dd>
					</div>
					<div className="space-y-0.5 px-5 py-3">
						<dt className="text-xs text-muted-foreground">Latest</dt>
						<dd className="truncate font-mono text-sm">{latest ?? '—'}</dd>
					</div>
					<div className="space-y-0.5 px-5 py-3">
						<dt className="text-xs text-muted-foreground">Last checked</dt>
						<dd className="flex items-center gap-1 text-sm">
							{check.isPending ? 'Checking…' : formatRelative(version?.lastCheckedAt, 'Never')}
							<Button variant="ghost" size="icon-xs" aria-label="Check for updates" disabled={check.isPending} onClick={() => check.mutate()}>
								<RefreshCwIcon className={cn(check.isPending && 'animate-spin')} />
							</Button>
						</dd>
					</div>
				</dl>
				{check.isError && (
					<p role="alert" className="border-t bg-destructive/5 px-5 py-2 text-sm text-destructive">
						Could not check for updates.
					</p>
				)}
			</section>

			<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
				<div className="min-w-0 space-y-1 bg-card px-4 py-3">
					<dt className="text-xs text-muted-foreground">API uptime</dt>
					<dd className="truncate text-sm font-medium tabular-nums">{formatUptime(health?.uptime)}</dd>
					<dd className="truncate text-xs text-muted-foreground">API process</dd>
				</div>
				<div className="min-w-0 space-y-1 bg-card px-4 py-3">
					<dt className="text-xs text-muted-foreground">Node runtime</dt>
					<dd className="truncate font-mono text-sm font-medium">{health?.node ?? '—'}</dd>
					<dd className="truncate text-xs text-muted-foreground">API process</dd>
				</div>
			</dl>

			<ListCard
				title="Available releases"
				action={version?.availableVersions.length ? <Badge variant="secondary">{version.availableVersions.length}</Badge> : undefined}
			>
				{version?.availableVersions.length ? (
					version.availableVersions.map(release => (
						<li key={release.version} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
							<div className="flex min-w-40 flex-1 items-center gap-2">
								<span className="font-mono text-sm font-medium">{release.version}</span>
								{release.version === latest && (
									<Badge variant="outline" className="border-primary/30 text-primary-text">
										Latest
									</Badge>
								)}
								{release.version === current && <Badge variant="secondary">Current</Badge>}
							</div>
							{release.publishedAt && (
								<span className="text-xs text-muted-foreground" title={formatDateTime(release.publishedAt)}>
									{formatRelative(release.publishedAt)}
								</span>
							)}
							{release.changelogUrl && (
								<a
									href={release.changelogUrl}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
									aria-label={`Changelog for ${release.version}`}
								>
									Changelog
									<ExternalLinkIcon className="size-3" />
								</a>
							)}
							{isNewerVersion(release.version, current) && (
								<Button variant="ghost" size="sm" disabled={trigger.isPending} onClick={() => void startUpdate(release.version)}>
									<DownloadIcon />
									Update
								</Button>
							)}
						</li>
					))
				) : (
					<EmptyRow icon={PackageCheckIcon} title="You're on the latest release." />
				)}
			</ListCard>

			<UpdateHistory runs={runs} onViewLogs={runId => showProgress(runId, false)} />

			<UpdateProgressDialog runId={progress?.runId ?? null} autoReload={progress?.autoReload} open={progressOpen} onOpenChange={setProgressOpen} />
		</>
	);
}

function UpdateHistory({ runs, onViewLogs }: { runs: UpdateRun[]; onViewLogs: (runId: string) => void }) {
	return (
		<SettingsCard title="Update history" description="Platform updates and network reconciliations.">
			{runs.length === 0 ? (
				<p className="text-sm text-muted-foreground">No updates performed yet.</p>
			) : (
				<div className="-mx-5 -mb-5 border-t">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-5">Run</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Started</TableHead>
								<TableHead className="text-right">Duration</TableHead>
								<TableHead className="pr-5">
									<span className="sr-only">Logs</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{runs.map(run => {
								const status = updateRunStatusMeta(run.status);
								return (
									<TableRow key={run.id}>
										<TableCell className="max-w-72 pl-5">
											<div className="font-mono text-xs">{updateRunTitle(run)}</div>
											{run.lastError && (
												<div className="truncate text-xs text-destructive" title={run.lastError}>
													{run.lastError}
												</div>
											)}
										</TableCell>
										<TableCell>
											<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', status.className)}>
												<status.icon className={cn('size-3.5', status.spin && 'animate-spin')} />
												{status.label}
											</span>
										</TableCell>
										<TableCell className="text-muted-foreground" title={formatDateTime(run.startedAt ?? run.createdAt)}>
											{formatRelative(run.startedAt ?? run.createdAt, '—')}
										</TableCell>
										<TableCell className="text-right font-mono text-xs">{formatDuration(run.startedAt, run.finishedAt)}</TableCell>
										<TableCell className="pr-5 text-right">
											<Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onViewLogs(run.id)}>
												<FileTextIcon />
												Logs
											</Button>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}
		</SettingsCard>
	);
}
