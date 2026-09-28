'use client';

import {
	AlertTriangleIcon,
	CheckCircle2Icon,
	ChevronRightIcon,
	CircleDotIcon,
	CopyIcon,
	DownloadIcon,
	GitCommitHorizontalIcon,
	HistoryIcon,
	Loader2Icon,
	MoreHorizontalIcon,
	RotateCcwIcon,
	ScrollTextIcon,
	XCircleIcon
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DeploymentBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { isDatabase, type Deployment, type DeploymentEvent, type Service } from '@/lib/mock';
import { cn } from '@/lib/utils';
import { Terminal } from './ansi';

const live = (d: Deployment) => d.status === 'pending' || d.status === 'deploying' || d.status === 'canceling';

export function DeploymentsTab({
	service,
	deployments,
	onDeploy,
	onCancel,
	onViewLogs
}: {
	service: Service;
	deployments: Deployment[];
	onDeploy: () => void;
	onCancel: () => void;
	onViewLogs: () => void;
}) {
	const head = deployments[0];
	const active = deployments.find(d => d.status === 'succeeded');
	const [open, setOpen] = useState<string | null>(head && (live(head) || head.status === 'failed') ? head.id : null);
	const [openedFor, setOpenedFor] = useState(head?.id);
	if (head && head.id !== openedFor) {
		setOpenedFor(head.id);
		if (live(head)) setOpen(head.id);
	}

	return (
		<div className="space-y-6">
			{active && (
				<section className="overflow-hidden rounded-lg border">
					<div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
						<CheckCircle2Icon className="size-3.5 text-success" />
						Active deployment
						<span className="ml-auto">{active.ago}</span>
					</div>
					<div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
						<div className="min-w-0 space-y-1.5">
							<div className="truncate font-medium">{active.message}</div>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
								{active.commit && (
									<span className="inline-flex items-center gap-1 font-mono">
										<GitCommitHorizontalIcon className="size-3.5" />
										{active.commit}
									</span>
								)}
								{service.branch && <span className="font-mono">{service.branch}</span>}
								<span>by {active.author}</span>
								<span>{active.trigger === 'auto' ? 'Auto-deploy on push' : 'Manual'}</span>
								<span>built in {active.duration}</span>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button variant="outline" size="sm" onClick={onViewLogs}>
								<ScrollTextIcon /> Logs
							</Button>
							<Button variant="outline" size="sm" onClick={onDeploy}>
								<RotateCcwIcon /> Redeploy
							</Button>
						</div>
					</div>
					<dl className="grid grid-cols-3 border-t text-xs">
						<Meta label="Replicas" value={`${service.replicas[0]}/${service.replicas[1]} ready`} />
						<Meta label="Image" value={isDatabase(service.type) ? service.source : `${service.name}:${active.commit ?? 'latest'}`} />
						<Meta label="Region" value="cluster · default" />
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
					{deployments.map(d => (
						<Collapsible key={d.id} open={open === d.id} onOpenChange={o => setOpen(o ? d.id : null)}>
							<div className="flex items-center gap-3 px-3 py-2.5">
								<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Toggle deployment ${d.commit ?? d.id}`}>
									<ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open === d.id && 'rotate-90')} />
									<DeploymentBadge status={d.status} className="w-24 justify-center" />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm">{d.message}</div>
										<div className="truncate text-xs text-muted-foreground">
											{d.commit && <span className="font-mono">{d.commit}</span>}
											{d.commit && ' · '}
											{live(d) ? <span className="text-info">{d.phase}…</span> : d.duration}
										</div>
									</div>
									<span className="shrink-0 text-xs text-muted-foreground">{d.ago}</span>
								</CollapsibleTrigger>
								{live(d) && d.status !== 'canceling' ? (
									<Button variant="ghost" size="xs" onClick={onCancel}>
										Cancel
									</Button>
								) : (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon-xs" aria-label="Deployment actions">
												<MoreHorizontalIcon />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem onSelect={onDeploy}>
												<RotateCcwIcon /> {d.status === 'succeeded' ? 'Redeploy' : 'Rollback to this'}
											</DropdownMenuItem>
											<DropdownMenuItem onSelect={() => setOpen(d.id)}>
												<ScrollTextIcon /> View build logs
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								)}
							</div>
							<CollapsibleContent className="space-y-4 border-t bg-muted/30 px-4 py-4">
								{d.error && (
									<div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
										<AlertTriangleIcon className="mt-px size-4 shrink-0" />
										<span className="font-mono">{d.error}</span>
									</div>
								)}
								<Timeline events={d.events} live={live(d)} />
								{d.buildLog.length > 0 && <BuildLog lines={d.buildLog} />}
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

function Timeline({ events, live }: { events: DeploymentEvent[]; live: boolean }) {
	return (
		<ol className="relative space-y-3 pl-6 before:absolute before:top-1.5 before:bottom-1.5 before:left-[7px] before:w-px before:bg-border">
			{events.map((e, i) => (
				<li key={i} className="relative text-sm">
					<span className="absolute top-0.5 -left-6 flex size-4 items-center justify-center rounded-full bg-card">
						{e.level === 'error' ? (
							<XCircleIcon className="size-4 text-destructive" />
						) : e.level === 'warn' ? (
							<AlertTriangleIcon className="size-4 text-warning" />
						) : (
							<CircleDotIcon className="size-4 text-muted-foreground" />
						)}
					</span>
					<div className="flex items-baseline gap-3">
						<span className="font-mono text-xs text-muted-foreground">{e.at}</span>
						<span className="text-xs font-medium">{e.step}</span>
					</div>
					<div className="text-muted-foreground">{e.message}</div>
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

function BuildLog({ lines }: { lines: string[] }) {
	const [full, setFull] = useState(false);
	const plain = lines.map(l => l.replace(/\x1b\[\d+m/g, '')).join('\n');
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
						onClick={() => {
							void navigator.clipboard?.writeText(plain);
							toast.success('Build log copied');
						}}
					>
						<CopyIcon />
					</Button>
					<Button variant="ghost" size="icon-xs" aria-label="Download build log" asChild>
						<a href={`data:text/plain;charset=utf-8,${encodeURIComponent(plain)}`} download="build.log">
							<DownloadIcon />
						</a>
					</Button>
					<Button variant="ghost" size="xs" onClick={() => setFull(f => !f)}>
						{full ? 'Collapse' : 'Expand'}
					</Button>
				</div>
			</div>
			<Terminal lines={full ? lines : lines.slice(-10)} className={full ? 'max-h-[28rem]' : 'max-h-56'} />
		</div>
	);
}
