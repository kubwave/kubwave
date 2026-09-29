'use client';

import { BoxesIcon, CircleCheckIcon, CircleXIcon, ServerIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusDot } from '@/components/status-badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ClusterNodeCondition, ClusterNodeDetail, ClusterNodePod } from '@/lib/api/types';
import { formatBytes, formatRelative } from '@/lib/format';
import type { MetricsRange } from '@/lib/metrics-chart';
import { formatCpu, makeMetricsTimeFormatter } from '@/lib/metrics-format';
import { cn } from '@/lib/utils';
import { EmptyState, EventsList, formatCount, InfoStrip, NodeBadges, RangeToggle, ResourceTile, UsageChart } from './cluster-ui';
import { isConditionHealthy, isSettledPod, nodeBadges, nodeUnavailableMessage } from './model';
import { useClusterNode, useClusterNodeUsage } from './use-cluster';

const BACK_HREF = '/admin/monitoring?tab=nodes';

export function NodeDetail({ name }: { name: string }) {
	const { data: detail, isLoading } = useClusterNode(name);
	const unavailable = nodeUnavailableMessage(detail);

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
			<PageHeader
				eyebrow={
					<Breadcrumb>
						<BreadcrumbList className="text-xs">
							<BreadcrumbItem>
								<BreadcrumbLink asChild>
									<Link href={BACK_HREF}>Monitoring</Link>
								</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage className="font-mono">{name}</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				}
				title={
					<span className="flex flex-wrap items-center gap-3">
						<span className="flex size-9 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
							<ServerIcon className="size-4" />
						</span>
						<span className="font-mono">{name}</span>
						{detail?.available && <NodeBadges badges={nodeBadges(detail.node)} />}
					</span>
				}
			/>
			{isLoading ? (
				<Skeleton className="h-64 rounded-lg" />
			) : unavailable || !detail ? (
				<div className="rounded-lg border border-dashed px-4 py-16 text-center">
					<p className="text-sm text-muted-foreground">{unavailable}</p>
					<Button asChild variant="outline" size="sm" className="mt-4">
						<Link href={BACK_HREF}>Back to monitoring</Link>
					</Button>
				</div>
			) : (
				<NodeBody name={name} detail={detail} />
			)}
		</div>
	);
}

function NodeBody({ name, detail }: { name: string; detail: ClusterNodeDetail }) {
	const { node } = detail;
	return (
		<>
			<InfoStrip
				className="grid-cols-2"
				items={[
					{ label: 'Roles', value: node.roles.join(', ') || '—' },
					{ label: 'Kubelet', value: <span className="font-mono">{node.kubeletVersion || '—'}</span> }
				]}
			/>

			<section aria-label="Resources" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<ResourceTile label="CPU" meter={node.cpu} format={formatCpu} />
				<ResourceTile label="Memory" meter={node.memory} format={formatBytes} />
				<ResourceTile label="Pods" meter={node.pods} format={formatCount} />
				<ResourceTile label="Disk" meter={node.disk} format={formatBytes} />
			</section>

			<NodeUsage name={name} detail={detail} />

			<div className="grid gap-6 lg:grid-cols-[1fr_320px]">
				<section className="space-y-3">
					<h2 className="text-sm font-medium">Conditions</h2>
					<Conditions conditions={detail.conditions} />
				</section>
				<section className="space-y-3">
					<h2 className="text-sm font-medium">Taints</h2>
					<div className="rounded-lg border bg-card p-4">
						{detail.taints.length ? (
							<ul className="flex flex-wrap gap-1.5">
								{detail.taints.map(taint => (
									<li key={taint} className="rounded-md border bg-muted px-2 py-1 font-mono text-xs break-all">
										{taint}
									</li>
								))}
							</ul>
						) : (
							<p className="text-sm text-muted-foreground">No taints. Any pod can be scheduled here.</p>
						)}
					</div>
				</section>
			</div>

			<section className="space-y-3">
				<h2 className="flex items-center gap-2 text-sm font-medium">
					Pods <span className="text-muted-foreground tabular-nums">{detail.pods.length}</span>
				</h2>
				<Pods pods={detail.pods} />
			</section>

			<section className="space-y-3">
				<h2 className="flex items-center gap-2 text-sm font-medium">
					Warning events <span className="text-muted-foreground tabular-nums">{detail.events.length}</span>
				</h2>
				<EventsList events={detail.events} empty="No warning events for this node in the last hour." />
			</section>
		</>
	);
}

function NodeUsage({ name, detail }: { name: string; detail: ClusterNodeDetail }) {
	const [range, setRange] = useState<MetricsRange>('1h');
	const { data: usage, isPending } = useClusterNodeUsage(name, range);
	const formatTime = makeMetricsTimeFormatter(range);
	const allocatable = (capacity: number) => (capacity > 0 ? { value: capacity, label: 'Allocatable' } : undefined);

	return (
		<section className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-sm font-medium">Utilization</h2>
				{usage?.available && <RangeToggle value={range} onChange={setRange} />}
			</div>
			{isPending ? (
				<Skeleton className="h-72 rounded-lg" />
			) : !usage?.available ? (
				<p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
					No stored history. Enable the managed Prometheus to see this node&apos;s usage across the 1h/24h/7d ranges.
				</p>
			) : (
				<div className={cn('grid gap-4', usage.series.diskBytes.length > 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
					<UsageChart
						title="CPU usage"
						points={usage.series.cpuMillicores}
						format={formatCpu}
						formatTime={formatTime}
						color="var(--primary-text)"
						limit={allocatable(detail.node.cpu.capacity)}
					/>
					<UsageChart
						title="Memory usage"
						points={usage.series.memoryBytes}
						format={formatBytes}
						formatTime={formatTime}
						color="var(--chart-5)"
						limit={allocatable(detail.node.memory.capacity)}
					/>
					{usage.series.diskBytes.length > 0 && (
						<UsageChart
							title="Disk usage"
							points={usage.series.diskBytes}
							format={formatBytes}
							formatTime={formatTime}
							color="var(--chart-4)"
							limit={allocatable(detail.node.disk.capacity)}
						/>
					)}
				</div>
			)}
		</section>
	);
}

function Conditions({ conditions }: { conditions: ClusterNodeCondition[] }) {
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">Type</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Reason</TableHead>
						<TableHead className="pr-4 text-right">Last transition</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{conditions.map(condition => {
						const healthy = isConditionHealthy(condition);
						const Icon = healthy ? CircleCheckIcon : CircleXIcon;
						return (
							<TableRow key={condition.type} className={cn(!healthy && 'bg-warning/[0.06]')}>
								<TableCell className="pl-4 font-medium">{condition.type}</TableCell>
								<TableCell>
									<span className={cn('inline-flex items-center gap-1.5 font-mono text-xs', healthy ? 'text-success' : 'text-warning')}>
										<Icon className="size-3.5" />
										{condition.status}
									</span>
								</TableCell>
								<TableCell className="text-sm">{condition.reason ?? '—'}</TableCell>
								<TableCell className="pr-4 text-right text-muted-foreground">{formatRelative(condition.lastTransitionTime, '—')}</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}

function podTone(pod: ClusterNodePod): { dot: string; text: string } {
	if (pod.status === 'Running') return { dot: 'bg-success', text: 'text-foreground' };
	if (isSettledPod(pod.status)) return { dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' };
	return { dot: 'bg-warning', text: 'text-warning' };
}

function Pods({ pods }: { pods: ClusterNodePod[] }) {
	if (pods.length === 0) return <EmptyState icon={BoxesIcon} title="No pods" description="Nothing is scheduled to this node right now." />;
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">Namespace</TableHead>
						<TableHead>Name</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Restarts</TableHead>
						<TableHead className="text-right">CPU</TableHead>
						<TableHead className="pr-4 text-right">Memory</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{pods.map(pod => {
						const tone = podTone(pod);
						return (
							<TableRow key={`${pod.namespace}/${pod.name}`}>
								<TableCell className="pl-4 font-mono text-xs text-muted-foreground">{pod.namespace}</TableCell>
								<TableCell className="font-mono text-xs">{pod.name}</TableCell>
								<TableCell>
									<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', tone.text)}>
										<StatusDot className={cn('size-1.5', tone.dot)} />
										{pod.status}
									</span>
								</TableCell>
								<TableCell className={cn('text-right tabular-nums', pod.restarts > 0 ? 'text-warning' : 'text-muted-foreground')}>
									{pod.restarts}
								</TableCell>
								<TableCell className="text-right font-mono text-xs">{pod.cpuMillicores == null ? '—' : formatCpu(pod.cpuMillicores)}</TableCell>
								<TableCell className="pr-4 text-right font-mono text-xs">{pod.memoryBytes == null ? '—' : formatBytes(pod.memoryBytes)}</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
