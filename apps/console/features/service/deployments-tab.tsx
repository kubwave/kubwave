'use client';

import {
	AlertTriangleIcon,
	BanIcon,
	CheckCircle2Icon,
	ChevronRightIcon,
	CircleDotIcon,
	CopyIcon,
	DownloadIcon,
	HistoryIcon,
	Loader2Icon,
	RotateCcwIcon,
	ScrollTextIcon,
	XCircleIcon
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DeploymentBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import type { Deployment, DeploymentLog, Service, ServiceRuntime } from '@/lib/api/types';
import { buildLogLines } from '@/lib/build-log';
import { canCancelDeployment, hasBuildStep } from '@/lib/deployments';
import { downloadText } from '@/lib/download';
import { formatDuration, formatRelative } from '@/lib/format';
import { serviceSource } from '@/lib/service-types';
import { cn } from '@/lib/utils';
import { Terminal } from './terminal';
import { isLiveDeployment, useDeploymentLogs, useServiceDeployments } from './use-deployments';

const TRIGGER_LABEL: Record<Deployment['trigger'], string> = { manual: 'Manual deploy', auto: 'Auto-deploy', preview: 'PR preview deploy' };
const ERROR_CLAMP = 220;

export function DeploymentsTab({ service, runtime, onViewLogs }: { service: Service; runtime: ServiceRuntime | undefined; onViewLogs: () => void }) {
	const { deployments, isPending, deploy, cancel } = useServiceDeployments(service.id, service.environmentId);
	const [open, setOpen] = useState<string | null>(null);
	const [openedFor, setOpenedFor] = useState<string | undefined>();
	const head = deployments[0];
	// Open the newest deployment once it appears, so a running deploy shows its progress.
	if (head && head.id !== openedFor) {
		setOpenedFor(head.id);
		if (openedFor === undefined || isLiveDeployment(head)) setOpen(head.id);
	}
	const current = deployments.find(deployment => deployment.status === 'succeeded');

	if (isPending) return <Skeleton className="h-40 w-full" />;
	if (deployments.length === 0)
		return (
			<div className="rounded-lg border border-dashed px-6 py-10 text-center">
				<p className="font-medium">Not deployed yet</p>
				<p className="mt-1 text-sm text-muted-foreground">Deploy to roll out {service.name} with its current settings.</p>
				<Button size="sm" className="mt-4" disabled={deploy.isPending} onClick={() => deploy.mutate()}>
					<RotateCcwIcon /> Deploy
				</Button>
			</div>
		);

	return (
		<div className="space-y-6">
			{current && (
				<section className="overflow-hidden rounded-lg border">
					<div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
						<CheckCircle2Icon className="size-3.5 text-success" />
						Active deployment
						<span className="ml-auto">{formatRelative(current.finishedAt ?? current.createdAt)}</span>
					</div>
					<div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
						<div className="min-w-0 space-y-1.5">
							<div className="truncate font-medium">{TRIGGER_LABEL[current.trigger]}</div>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
								<span>finished in {formatDuration(current.startedAt, current.finishedAt)}</span>
								{current.attempts > 1 && <span>{current.attempts} attempts</span>}
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="sm" onClick={onViewLogs}>
								<ScrollTextIcon /> Logs
							</Button>
							<Button variant="outline" size="sm" disabled={deploy.isPending} onClick={() => deploy.mutate()}>
								<RotateCcwIcon /> Redeploy
							</Button>
						</div>
					</div>
					<dl className="grid grid-cols-2 border-t text-xs">
						<Meta label="Replicas" value={runtime ? `${runtime.readyReplicas}/${runtime.desiredReplicas} ready` : '—'} />
						<Meta label="Source" value={serviceSource(service).label} />
					</dl>
				</section>
			)}

			<section>
				<div className="mb-2 flex items-center gap-2">
					<HistoryIcon className="size-4 text-muted-foreground" />
					<h3 className="text-sm font-medium">History</h3>
					<span className="text-xs text-muted-foreground">{deployments.length}</span>
				</div>
				<div className="divide-y rounded-lg border">
					{deployments.map(deployment => (
						<Collapsible key={deployment.id} open={open === deployment.id} onOpenChange={isOpen => setOpen(isOpen ? deployment.id : null)}>
							<div className="flex items-center gap-3 px-3 py-2.5">
								<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Toggle deployment ${deployment.id}`}>
									<ChevronRightIcon
										className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open === deployment.id && 'rotate-90')}
									/>
									<DeploymentBadge status={deployment.status} className="w-24 justify-center" />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm">{TRIGGER_LABEL[deployment.trigger]}</div>
										<div className="truncate text-xs text-muted-foreground">
											{isLiveDeployment(deployment) ? (
												<span className="text-info">{deployment.phase ?? 'queued'}…</span>
											) : (
												formatDuration(deployment.startedAt, deployment.finishedAt)
											)}
										</div>
									</div>
									<span className="shrink-0 text-xs text-muted-foreground">{formatRelative(deployment.createdAt)}</span>
								</CollapsibleTrigger>
								{canCancelDeployment(deployment) && (
									<Button variant="ghost" size="xs" disabled={cancel.isPending} onClick={() => cancel.mutate(deployment.id)}>
										Cancel
									</Button>
								)}
							</div>
							<CollapsibleContent className="space-y-4 border-t bg-muted/30 px-4 py-4">
								{open === deployment.id && <DeploymentDetails deployment={deployment} />}
							</CollapsibleContent>
						</Collapsible>
					))}
				</div>
			</section>
		</div>
	);
}

function Meta({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 border-r px-4 py-2.5 last:border-r-0">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="mt-0.5 truncate font-mono">{value}</dd>
		</div>
	);
}

function DeploymentDetails({ deployment }: { deployment: Deployment }) {
	const { events, eventsPending, buildContainers } = useDeploymentLogs(deployment, true);
	const [fullError, setFullError] = useState(false);
	const error = deployment.lastError ?? '';
	return (
		<>
			{error && (
				<div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
					<AlertTriangleIcon className="mt-px size-4 shrink-0" />
					<span className="min-w-0 font-mono break-words">
						{fullError || error.length <= ERROR_CLAMP ? error : `${error.slice(0, ERROR_CLAMP).trimEnd()}…`}
						{error.length > ERROR_CLAMP && (
							<button type="button" className="ml-2 underline underline-offset-2" onClick={() => setFullError(value => !value)}>
								{fullError ? 'Show less' : 'Show more'}
							</button>
						)}
					</span>
				</div>
			)}
			{eventsPending ? <Skeleton className="h-16 w-full" /> : <Timeline events={events} live={isLiveDeployment(deployment)} />}
			{hasBuildStep(deployment) && buildContainers.length > 0 && <BuildLog deploymentId={deployment.id} containers={buildContainers} />}
		</>
	);
}

function eventIcon(event: DeploymentLog) {
	if (event.step === 'succeeded') return <CheckCircle2Icon className="size-4 text-success" />;
	if (event.step === 'failed' || event.level === 'error') return <XCircleIcon className="size-4 text-destructive" />;
	if (event.step === 'canceled') return <BanIcon className="size-4 text-muted-foreground" />;
	if (event.level === 'warn') return <AlertTriangleIcon className="size-4 text-warning" />;
	return <CircleDotIcon className="size-4 text-muted-foreground" />;
}

const clock = (iso: string) => {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

function Timeline({ events, live }: { events: DeploymentLog[]; live: boolean }) {
	if (events.length === 0 && !live) return <p className="text-sm text-muted-foreground">No events recorded.</p>;
	return (
		<ol className="relative space-y-3 pl-6 before:absolute before:top-1.5 before:bottom-1.5 before:left-[7px] before:w-px before:bg-border">
			{events.map((event, index) => (
				<li key={`${event.ts}-${event.step}-${index}`} className="relative text-sm">
					<span className="absolute top-0.5 -left-6 flex size-4 items-center justify-center rounded-full bg-card">{eventIcon(event)}</span>
					<span className="mr-3 font-mono text-xs text-muted-foreground">{clock(event.ts)}</span>
					<span className="text-muted-foreground">{event.message}</span>
				</li>
			))}
			{live && (
				<li className="relative flex items-center gap-2 text-sm text-info">
					<span className="absolute -left-6 flex size-4 items-center justify-center rounded-full bg-card">
						<Loader2Icon className="size-4 animate-spin" />
					</span>
					In progress…
				</li>
			)}
		</ol>
	);
}

const PREVIEW_LINES = 10;

function BuildLog({ deploymentId, containers }: { deploymentId: string; containers: { containerName: string; content: string }[] }) {
	const [full, setFull] = useState(false);
	const lines = buildLogLines(containers).map(line => ({ segments: line.segments, divider: line.showDivider ? line.container : undefined }));
	const text = lines.map(line => line.segments.map(segment => segment.text).join('')).join('\n');
	return (
		<div>
			<div className="mb-1.5 flex items-center gap-1">
				<span className="text-xs font-medium">Build log</span>
				<span className="text-xs text-muted-foreground">{lines.length} lines</span>
				<div className="ml-auto flex items-center">
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Copy build log"
						onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success('Build log copied'))}
					>
						<CopyIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Download build log"
						onClick={() => downloadText(`deployment-${deploymentId}-build.log`, text)}
					>
						<DownloadIcon />
					</Button>
					<Button variant="ghost" size="xs" onClick={() => setFull(value => !value)}>
						{full ? 'Collapse' : 'Expand'}
					</Button>
				</div>
			</div>
			<Terminal lines={full ? lines : lines.slice(-PREVIEW_LINES)} className={full ? 'max-h-[28rem]' : 'max-h-56'} />
		</div>
	);
}
