'use client';

import { ChevronRightIcon, CircleCheckIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EventsList, InfoStrip, MiniMeter, NodeBadges, RangeToggle, SplitMeterTile, UsageChart, splitConfig } from '@/components/admin/cluster-ui';
import { PageHeader } from '@/components/page-header';
import { RuntimeBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cluster, clusterComponents, clusterEvents, clusterNodes, clusterResources, nodeBadges, splitSeries, type Range } from '@/lib/mock-admin';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const unhealthy = clusterNodes.filter(n => !n.ready || n.pressure.length);
const readyCount = clusterNodes.filter(n => n.ready).length;
const cordonedCount = clusterNodes.filter(n => n.cordoned).length;
const warningCount = clusterEvents.filter(e => e.type === 'Warning').length;
const componentStatus = (c: { ready: number; desired: number }) => (c.ready === c.desired ? 'running' : c.ready === 0 ? 'failed' : 'degraded');
const cpu = clusterResources.find(r => r.id === 'cpu')!;
const memory = clusterResources.find(r => r.id === 'memory')!;

export default function ClusterPage() {
	const [range, setRange] = useState<Range>('24h');
	const cpuData = useMemo(() => splitSeries('cpu', range), [range]);
	const memData = useMemo(() => splitSeries('memory', range), [range]);
	const healthy = !unhealthy.length;

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
			<PageHeader
				title="Cluster"
				description={
					<>
						<span className="font-mono">{cluster.name}</span> · {cluster.provider}
					</>
				}
				actions={
					<>
						<span className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
							<span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
							Live · updated 12s ago
						</span>
						<Button variant="outline" size="sm" onClick={() => toast.success('Metrics refreshed')}>
							<RefreshCwIcon />
							Refresh
						</Button>
					</>
				}
			/>

			<InfoStrip
				items={[
					{
						label: 'State',
						value: healthy ? (
							<span className="flex items-center gap-1.5 text-success">
								<CircleCheckIcon className="size-4" /> Cluster healthy
							</span>
						) : (
							<span className="flex items-center gap-1.5 text-warning">
								<TriangleAlertIcon className="size-4" /> Cluster degraded
							</span>
						),
						hint: healthy ? 'All nodes and components ready' : unhealthy.map(n => `${n.name}: ${n.pressure.join(', ') || 'NotReady'}`).join(' · ')
					},
					{
						label: 'Nodes ready',
						value: (
							<span className="tabular-nums">
								{readyCount}/{clusterNodes.length}
							</span>
						),
						hint: cordonedCount ? `${cordonedCount} cordoned` : 'All schedulable'
					},
					{ label: 'Kubernetes', value: <span className="font-mono">{cluster.k8sVersion}</span>, hint: 'k3s distribution' },
					{ label: 'Uptime', value: <span className="tabular-nums">{cluster.uptime}</span>, hint: 'since Aug 18, 2026' }
				]}
			/>

			<section aria-label="Capacity" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{clusterResources.map(r => (
					<SplitMeterTile key={r.id} resource={r} />
				))}
			</section>

			<Tabs defaultValue="utilization" className="gap-4">
				<TabsList>
					<TabsTrigger value="utilization">Utilization</TabsTrigger>
					<TabsTrigger value="nodes">
						Nodes <span className="text-muted-foreground tabular-nums">{clusterNodes.length}</span>
					</TabsTrigger>
					<TabsTrigger value="components">Components</TabsTrigger>
					<TabsTrigger value="events">
						Events
						{warningCount > 0 && <span className="rounded-full bg-warning/15 px-1.5 text-[11px] text-warning tabular-nums">{warningCount}</span>}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="utilization" className="space-y-4">
					<div className="flex items-center justify-between gap-3">
						<p className="text-xs text-muted-foreground">Actual usage by workload owner, sampled by metrics-server.</p>
						<RangeToggle value={range} onChange={setRange} />
					</div>
					<div className="grid gap-4 lg:grid-cols-2">
						<UsageChart title="CPU usage" subtitle={`cores · capacity ${cpu.usage.capacity}`} data={cpuData} config={splitConfig} />
						<UsageChart title="Memory usage" subtitle={`GiB · capacity ${memory.usage.capacity}`} data={memData} config={splitConfig} unit="GiB" />
					</div>
				</TabsContent>

				<TabsContent value="nodes">
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
									<TableHead className="text-right">Pods</TableHead>
									<TableHead className="text-right">Age</TableHead>
									<TableHead className="w-8" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{clusterNodes.map(n => (
									<TableRow key={n.name} className="group relative">
										<TableCell className="pl-4">
											<Link
												href={`/admin/cluster/nodes/${n.name}`}
												className="font-mono font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
											>
												{n.name}
											</Link>
											<div className="font-mono text-xs text-muted-foreground">{n.ip}</div>
										</TableCell>
										<TableCell className="text-muted-foreground">{n.roles.join(', ')}</TableCell>
										<TableCell>
											<NodeBadges badges={nodeBadges(n)} />
										</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">{n.kubelet}</TableCell>
										<TableCell>
											<MiniMeter value={n.cpu.used} max={n.cpu.capacity} label="CPU" />
										</TableCell>
										<TableCell>
											<MiniMeter value={n.memory.used} max={n.memory.capacity} label="Memory" />
										</TableCell>
										<TableCell className="text-right text-muted-foreground tabular-nums">
											<span className="text-foreground">{n.pods.used}</span>/{n.pods.capacity}
										</TableCell>
										<TableCell className="text-right text-muted-foreground">{n.age}</TableCell>
										<TableCell className="pr-3">
											<ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</TabsContent>

				<TabsContent value="components">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{clusterComponents.map(c => {
							const status = componentStatus(c);
							return (
								<div key={c.name} className={cn('rounded-lg border bg-card p-4', status !== 'running' && 'border-warning/40')}>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<div className="truncate font-mono text-sm font-medium">{c.name}</div>
											<div className="mt-0.5 text-xs text-muted-foreground">{c.purpose}</div>
										</div>
										<RuntimeBadge status={status} replicas={[c.ready, c.desired]} />
									</div>
									<div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
										<span className="font-mono">{c.namespace}</span>
										<span aria-hidden>·</span>
										{c.kind}
										<span className="ml-auto rounded border px-1.5 font-mono">{c.version}</span>
									</div>
								</div>
							);
						})}
					</div>
				</TabsContent>

				<TabsContent value="events">
					<EventsList events={clusterEvents} filterable />
				</TabsContent>
			</Tabs>
		</div>
	);
}
