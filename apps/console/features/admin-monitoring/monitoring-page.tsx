'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
	BoxesIcon,
	ChevronRightIcon,
	CircleCheckIcon,
	CircleHelpIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	ServerIcon,
	TriangleAlertIcon
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { RuntimeBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { queryKeys } from '@/lib/api/query-keys';
import type { ClusterComponent, ClusterNode, ClusterSnapshot } from '@/lib/api/types';
import { formatBytes, formatRelative } from '@/lib/format';
import type { MetricsRange } from '@/lib/metrics-chart';
import { formatCpu, makeMetricsTimeFormatter } from '@/lib/metrics-format';
import { cn } from '@/lib/utils';
import { EmptyState, EventsList, formatCount, InfoStrip, MiniMeter, NodeBadges, RangeToggle, ResourceTile, UsageChart } from './cluster-ui';
import {
	componentHealth,
	componentsByHealth,
	nodeBadges,
	nodeHref,
	parseMonitoringTab,
	problemSummary,
	searchWithTab,
	type LiveSeries,
	type MonitoringTab
} from './model';
import { useClusterEvents, useClusterLiveSeries, useClusterSnapshot, useClusterUsage } from './use-cluster';

export function MonitoringPage({ initialTab }: { initialTab: MonitoringTab }) {
	const [tab, setTab] = useState(initialTab);
	const { data: snapshot, isFetching } = useClusterSnapshot();
	const liveSeries = useClusterLiveSeries(snapshot);
	const queryClient = useQueryClient();
	const unhealthyComponents = snapshot?.components.filter(component => componentHealth(component) !== 'running').length ?? 0;

	const changeTab = (value: string) => {
		const next = parseMonitoringTab(value);
		setTab(next);
		window.history.replaceState(null, '', window.location.pathname + searchWithTab(window.location.search, next));
	};

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
			<PageHeader
				title="Monitoring"
				description="Cluster capacity, node health, and recent warnings."
				actions={
					<>
						{snapshot?.available && (
							<span className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
								<span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
								Live · updated {formatRelative(snapshot.sampledAt)}
							</span>
						)}
						{/* The cluster key prefixes events, usage and node queries, so this refreshes whatever is on screen. */}
						<Button
							variant="outline"
							size="sm"
							disabled={isFetching}
							onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.clusterSnapshot })}
						>
							<RefreshCwIcon className={cn(isFetching && 'animate-spin')} />
							Refresh
						</Button>
					</>
				}
			/>

			<StatusStrip snapshot={snapshot} />
			<CapacityTiles snapshot={snapshot} />

			<Tabs value={tab} onValueChange={changeTab} className="gap-4">
				<TabsList>
					<TabsTrigger value="utilization">Utilization</TabsTrigger>
					<TabsTrigger value="nodes">
						Nodes {snapshot && snapshot.nodes.length > 0 && <span className="text-muted-foreground tabular-nums">{snapshot.nodes.length}</span>}
					</TabsTrigger>
					<TabsTrigger value="components">
						Components
						{unhealthyComponents > 0 && (
							<span className="rounded-full bg-warning/15 px-1.5 text-[11px] text-warning tabular-nums">{unhealthyComponents}</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="events">Events</TabsTrigger>
				</TabsList>
				<TabsContent value="utilization">
					<Utilization snapshot={snapshot} liveSeries={liveSeries} />
				</TabsContent>
				<TabsContent value="nodes">
					<NodesTable nodes={snapshot?.nodes ?? []} />
				</TabsContent>
				<TabsContent value="components">
					<ComponentsGrid components={snapshot?.components ?? []} />
				</TabsContent>
				<TabsContent value="events">
					<EventsTab />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function StateValue({ state }: { state: ClusterSnapshot['state'] | undefined }) {
	if (state === 'ok')
		return (
			<span className="flex items-center gap-1.5 text-success">
				<CircleCheckIcon className="size-4" /> Cluster healthy
			</span>
		);
	if (state === 'degraded')
		return (
			<span className="flex items-center gap-1.5 text-warning">
				<TriangleAlertIcon className="size-4" /> Cluster degraded
			</span>
		);
	return (
		<span className="flex items-center gap-1.5 text-muted-foreground">
			<CircleHelpIcon className="size-4" /> Cluster status unknown
		</span>
	);
}

function stateHint(snapshot: ClusterSnapshot | undefined): string {
	if (!snapshot) return 'Reading cluster…';
	if (!snapshot.available) return 'The cluster could not be reached';
	return problemSummary(snapshot) || 'All nodes and components ready';
}

function StatusStrip({ snapshot }: { snapshot: ClusterSnapshot | undefined }) {
	const live = snapshot?.available ? snapshot : undefined;
	const cordoned = live?.nodes.filter(node => node.cordoned).length ?? 0;
	const readyComponents = live?.components.filter(component => componentHealth(component) === 'running').length ?? 0;
	const unhealthyComponents = (live?.components.length ?? 0) - readyComponents;
	return (
		<InfoStrip
			className="grid-cols-1 sm:grid-cols-3"
			items={[
				{ label: 'State', value: <StateValue state={snapshot?.state} />, hint: stateHint(snapshot) },
				{
					label: 'Nodes ready',
					value: live ? <span className="tabular-nums">{`${live.nodesReady}/${live.nodesTotal}`}</span> : '—',
					hint: live && (cordoned > 0 ? `${cordoned} cordoned` : 'All schedulable')
				},
				{
					label: 'Platform components',
					value: live ? <span className="tabular-nums">{`${readyComponents}/${live.components.length}`}</span> : '—',
					hint: live && (unhealthyComponents > 0 ? `${unhealthyComponents} not ready` : 'All ready')
				}
			]}
		/>
	);
}

function CapacityTiles({ snapshot }: { snapshot: ClusterSnapshot | undefined }) {
	if (!snapshot)
		return (
			<section aria-label="Capacity" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton key={index} className="h-40 rounded-lg" />
				))}
			</section>
		);
	const { split } = snapshot;
	return (
		<section aria-label="Capacity" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<ResourceTile
				label="CPU"
				meter={snapshot.cpu}
				format={formatCpu}
				split={{ platform: split.platform.cpuMillicores, tenants: split.tenants.cpuMillicores, other: split.other.cpuMillicores }}
			/>
			<ResourceTile
				label="Memory"
				meter={snapshot.memory}
				format={formatBytes}
				split={{ platform: split.platform.memoryBytes, tenants: split.tenants.memoryBytes, other: split.other.memoryBytes }}
			/>
			<ResourceTile label="Volumes" meter={snapshot.storage} format={formatBytes} />
			<ResourceTile label="Pods" meter={snapshot.pods} format={formatCount} />
		</section>
	);
}

function Utilization({ snapshot, liveSeries }: { snapshot: ClusterSnapshot | undefined; liveSeries: LiveSeries }) {
	const [range, setRange] = useState<MetricsRange>('1h');
	const { data: usage } = useClusterUsage(range);
	const historical = usage?.available === true;
	const formatTime = makeMetricsTimeFormatter(range);
	const cpuCapacity = snapshot?.cpu.capacity ?? 0;
	const memoryCapacity = snapshot?.memory.capacity ?? 0;

	return (
		<div className="space-y-4">
			{historical ? (
				<div className="flex items-center justify-between gap-3">
					<p className="text-xs text-muted-foreground">Historical · Prometheus</p>
					<RangeToggle value={range} onChange={setRange} />
				</div>
			) : (
				<p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
					Live usage · sampled every 15s in this session. Enable the managed Prometheus for persisted history across the 1h/24h/7d ranges.
				</p>
			)}
			<div className="grid gap-4 lg:grid-cols-2">
				<UsageChart
					title="CPU usage"
					subtitle={cpuCapacity > 0 && `capacity ${formatCpu(cpuCapacity)}`}
					points={historical ? usage.series.cpuMillicores : liveSeries.cpuMillicores}
					format={formatCpu}
					formatTime={formatTime}
					color="var(--primary-text)"
				/>
				<UsageChart
					title="Memory usage"
					subtitle={memoryCapacity > 0 && `capacity ${formatBytes(memoryCapacity)}`}
					points={historical ? usage.series.memoryBytes : liveSeries.memoryBytes}
					format={formatBytes}
					formatTime={formatTime}
					color="var(--chart-5)"
				/>
			</div>
		</div>
	);
}

function podsText(node: ClusterNode): string {
	return `${Math.round(node.pods.used ?? 0)}/${Math.round(node.pods.capacity)}`;
}

function NodesTable({ nodes }: { nodes: ClusterNode[] }) {
	if (nodes.length === 0) return <EmptyState icon={ServerIcon} title="No nodes" description="The cluster reported no nodes for this snapshot." />;
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">Name</TableHead>
						<TableHead>Roles</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Kubelet</TableHead>
						<TableHead>CPU</TableHead>
						<TableHead>Memory</TableHead>
						<TableHead>Disk</TableHead>
						<TableHead className="text-right">Pods</TableHead>
						<TableHead className="w-8" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{nodes.map(node => (
						<TableRow key={node.name} className="group relative">
							<TableCell className="pl-4">
								<Link href={nodeHref(node.name)} className="font-mono font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
									{node.name}
								</Link>
							</TableCell>
							<TableCell className="text-muted-foreground">{node.roles.join(', ') || '—'}</TableCell>
							<TableCell>
								<NodeBadges badges={nodeBadges(node)} />
							</TableCell>
							<TableCell className="font-mono text-xs text-muted-foreground">{node.kubeletVersion || '—'}</TableCell>
							<TableCell>
								<MiniMeter meter={node.cpu} format={formatCpu} label="CPU" />
							</TableCell>
							<TableCell>
								<MiniMeter meter={node.memory} format={formatBytes} label="Memory" />
							</TableCell>
							<TableCell>
								<MiniMeter meter={node.disk} format={formatBytes} label="Disk" />
							</TableCell>
							<TableCell className="text-right text-muted-foreground tabular-nums">{podsText(node)}</TableCell>
							<TableCell className="pr-3">
								<ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function ComponentsGrid({ components }: { components: ClusterComponent[] }) {
	if (components.length === 0)
		return (
			<EmptyState
				icon={BoxesIcon}
				title="No platform components found"
				description="Nothing in the platform namespace carried the kubwave labels for this snapshot."
			/>
		);
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{componentsByHealth(components).map(component => {
				const health = componentHealth(component);
				return (
					<div key={component.name} className={cn('rounded-lg border bg-card p-4', health !== 'running' && 'border-warning/40')}>
						<div className="flex items-center justify-between gap-3">
							<div className="min-w-0 truncate font-mono text-sm font-medium">{component.name}</div>
							<RuntimeBadge status={health} replicas={[component.ready, component.desired]} />
						</div>
					</div>
				);
			})}
		</div>
	);
}

function EventsTab() {
	const { data: events, isPending } = useClusterEvents();
	if (isPending)
		return (
			<p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
				<LoaderCircleIcon className="size-4 animate-spin" />
				Loading events…
			</p>
		);
	if (!events?.available)
		return (
			<p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
				Could not read events from the cluster.
			</p>
		);
	return <EventsList events={events.events} filterable empty="No warning events in the window Kubernetes still retains." />;
}
