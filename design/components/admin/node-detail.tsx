'use client';

import { BanIcon, ChevronDownIcon, CircleCheckIcon, CircleXIcon, PlayIcon, ServerIcon, WavesIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EventsList, InfoStrip, NodeBadges, RangeToggle, ResourceTile, UsageChart } from '@/components/admin/cluster-ui';
import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { StatusDot } from '@/components/status-badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import type { ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { clusterEvents, getNode, nodeBadges, nodeConditions, nodeSeries, type PodStatus, type Range } from '@/lib/mock-admin';
import { cn } from '@/lib/utils';

const UNSCHEDULABLE = 'node.kubernetes.io/unschedulable:NoSchedule';
const usedConfig = { used: { label: 'Used', color: 'var(--chart-1)' } } satisfies ChartConfig;

const podStatus: Record<PodStatus, { dot: string; text: string }> = {
	Running: { dot: 'bg-success', text: 'text-foreground' },
	Pending: { dot: 'bg-muted-foreground animate-pulse', text: 'text-muted-foreground' },
	CrashLoopBackOff: { dot: 'bg-destructive', text: 'text-destructive' },
	Completed: { dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
	Terminating: { dot: 'bg-warning animate-pulse', text: 'text-warning' }
};

export function NodeDetail({ name }: { name: string }) {
	const node = getNode(name)!;
	const [cordoned, setCordoned] = useState(node.cordoned);
	const [drainOpen, setDrainOpen] = useState(false);
	const [range, setRange] = useState<Range>('24h');
	const cpuData = useMemo(() => nodeSeries(node, 'cpu', range), [node, range]);
	const memData = useMemo(() => nodeSeries(node, 'memory', range), [node, range]);

	const conditions = nodeConditions(node);
	const taints = [...node.taints.filter(t => t !== UNSCHEDULABLE), ...(cordoned ? [UNSCHEDULABLE] : [])];
	const warnings = clusterEvents.filter(e => e.node === name && e.type === 'Warning');
	const evictable = node.workloads.filter(p => !p.name.startsWith('svclb-') && p.status !== 'Completed').length;

	const toggleCordon = () => {
		setCordoned(!cordoned);
		toast.success(cordoned ? `${name} uncordoned` : `${name} cordoned`, {
			description: cordoned ? 'New pods can be scheduled on this node again.' : 'Existing pods keep running; no new pods will be scheduled.'
		});
	};

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
			<PageHeader
				eyebrow={
					<Breadcrumb>
						<BreadcrumbList className="text-xs">
							<BreadcrumbItem>
								<BreadcrumbLink asChild>
									<Link href="/admin/cluster">Cluster</Link>
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
						<NodeBadges badges={nodeBadges({ ...node, cordoned })} />
					</span>
				}
				actions={
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="sm">
								Actions
								<ChevronDownIcon />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-52">
							<DropdownMenuItem onSelect={toggleCordon}>
								{cordoned ? <PlayIcon /> : <BanIcon />}
								{cordoned ? 'Uncordon' : 'Cordon'}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onSelect={() => setDrainOpen(true)}>
								<WavesIcon />
								Drain…
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			/>

			<InfoStrip
				items={[
					{ label: 'Roles', value: node.roles.join(', ') },
					{ label: 'Kubelet', value: <span className="font-mono">{node.kubelet}</span>, hint: <span className="font-mono">{node.runtime}</span> },
					{ label: 'OS / Arch', value: node.os, hint: <span className="font-mono">{`${node.arch} · ${node.kernel}`}</span> },
					{
						label: 'Internal IP',
						value: (
							<span className="flex items-center gap-1 font-mono">
								{node.ip}
								<CopyButton value={node.ip} label="Copy IP address" />
							</span>
						),
						hint: `Age ${node.age}`
					}
				]}
			/>

			<section aria-label="Resources" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<ResourceTile label="CPU" usage={node.cpu} unit="cores" />
				<ResourceTile label="Memory" usage={node.memory} unit="GiB" />
				<ResourceTile label="Pods" usage={node.pods} unit="pods" />
				<ResourceTile label="Ephemeral storage" usage={node.ephemeral} unit="GiB" />
			</section>

			<section className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<h2 className="text-sm font-medium">Utilization</h2>
					<RangeToggle value={range} onChange={setRange} />
				</div>
				<div className="grid gap-4 lg:grid-cols-2">
					<UsageChart
						title="CPU usage"
						subtitle="cores"
						data={cpuData}
						config={usedConfig}
						limit={{ value: node.cpu.capacity, label: 'Allocatable' }}
					/>
					<UsageChart
						title="Memory usage"
						subtitle="GiB"
						data={memData}
						config={usedConfig}
						unit="GiB"
						limit={{ value: node.memory.capacity, label: 'Allocatable' }}
					/>
				</div>
			</section>

			<div className="grid gap-6 lg:grid-cols-[1fr_320px]">
				<section className="space-y-3">
					<h2 className="text-sm font-medium">Conditions</h2>
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
								{conditions.map(c => {
									const ok = (c.type === 'Ready') === (c.status === 'True');
									const Icon = ok ? CircleCheckIcon : CircleXIcon;
									return (
										<TableRow key={c.type} className={cn(!ok && 'bg-warning/[0.06]')}>
											<TableCell className="pl-4 font-medium">{c.type}</TableCell>
											<TableCell>
												<span className={cn('inline-flex items-center gap-1.5 font-mono text-xs', ok ? 'text-success' : 'text-warning')}>
													<Icon className="size-3.5" />
													{c.status}
												</span>
											</TableCell>
											<TableCell className="max-w-72 whitespace-normal">
												<div className="text-sm">{c.reason}</div>
												<div className="text-xs text-muted-foreground">{c.message}</div>
											</TableCell>
											<TableCell className="pr-4 text-right text-muted-foreground">{c.lastTransition}</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				</section>
				<section className="space-y-3">
					<h2 className="text-sm font-medium">Taints</h2>
					<div className="rounded-lg border bg-card p-4">
						{taints.length ? (
							<ul className="flex flex-wrap gap-1.5">
								{taints.map(t => (
									<li key={t} className="rounded-md border bg-muted px-2 py-1 font-mono text-xs break-all">
										{t}
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
					Pods <span className="text-muted-foreground tabular-nums">{node.workloads.length}</span>
				</h2>
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
							{node.workloads.map(p => (
								<TableRow key={p.namespace + p.name}>
									<TableCell className="pl-4 font-mono text-xs text-muted-foreground">{p.namespace}</TableCell>
									<TableCell className="font-mono text-xs">{p.name}</TableCell>
									<TableCell>
										<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', podStatus[p.status].text)}>
											<StatusDot className={cn('size-1.5', podStatus[p.status].dot)} />
											{p.status}
										</span>
									</TableCell>
									<TableCell className={cn('text-right tabular-nums', p.restarts > 5 ? 'text-warning' : 'text-muted-foreground')}>
										{p.restarts}
									</TableCell>
									<TableCell className="text-right font-mono text-xs">{p.cpu ? `${p.cpu}m` : '—'}</TableCell>
									<TableCell className="pr-4 text-right font-mono text-xs">{p.memory ? `${p.memory}Mi` : '—'}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</section>

			<section className="space-y-3">
				<h2 className="flex items-center gap-2 text-sm font-medium">
					Warning events <span className="text-muted-foreground tabular-nums">{warnings.length}</span>
				</h2>
				<EventsList events={warnings} empty="No warning events for this node in the last hour." />
			</section>

			<Dialog open={drainOpen} onOpenChange={setDrainOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Drain <span className="font-mono">{name}</span>?
						</DialogTitle>
						<DialogDescription>
							The node is cordoned and {evictable} pods are evicted and rescheduled elsewhere. DaemonSet pods are ignored and PodDisruptionBudgets are
							respected.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDrainOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setDrainOpen(false);
								setCordoned(true);
								toast.success(`Draining ${name}`, { description: `Evicting ${evictable} pods. This can take a few minutes.` });
							}}
						>
							Drain node
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
