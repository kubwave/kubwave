'use client';

import { ArrowDownIcon, ArrowUpIcon, HardDriveIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { series, type Service } from '@/lib/mock';
import { cn } from '@/lib/utils';

const ranges = {
	'1h': { points: 60, label: (i: number) => `14:${String(i).padStart(2, '0')}`, deployAt: 44 },
	'24h': { points: 48, label: (i: number) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, deployAt: 40 },
	'7d': { points: 56, label: (i: number) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Math.floor(i / 8)]!, deployAt: 30 }
} as const;

type Range = keyof typeof ranges;

const cpuConfig = { cpu: { label: 'CPU', color: 'var(--chart-1)' } } satisfies ChartConfig;
const memConfig = { mem: { label: 'Memory', color: 'var(--chart-1)' } } satisfies ChartConfig;
const netConfig = { rx: { label: 'Inbound', color: 'var(--chart-1)' }, tx: { label: 'Outbound', color: 'var(--chart-2)' } } satisfies ChartConfig;

const axis = { tickLine: false, axisLine: false, fontSize: 11, stroke: 'var(--muted-foreground)' } as const;

export function MetricsTab({ service }: { service: Service }) {
	const [range, setRange] = useState<Range>('1h');
	const seed = service.name.length * 7 + range.length;
	const r = ranges[range];

	const data = useMemo(() => {
		const cpu = series(seed, r.points, 140, 90);
		const mem = series(seed + 3, r.points, 310, 40);
		const rx = series(seed + 5, r.points, 42, 30);
		const tx = series(seed + 9, r.points, 18, 14);
		return cpu.map((c, i) => ({ t: r.label(i), cpu: Math.round(c), mem: Math.round(mem[i]!), rx: +rx[i]!.toFixed(1), tx: +tx[i]!.toFixed(1) }));
	}, [seed, r]);

	if (service.status === 'not_deployed' || service.status === 'stopped') {
		return (
			<div className="rounded-lg border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
				No metrics yet. Deploy the service to start collecting.
			</div>
		);
	}

	const last = data[data.length - 1]!;
	const deployLabel = data[r.deployAt]?.t;

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<div className="mr-auto text-xs text-muted-foreground">
					<span className="font-medium text-foreground">Historical</span> · Prometheus · {service.replicas[1]} pod
					{service.replicas[1] === 1 ? '' : 's'}
				</div>
				<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<span className="h-3 w-px bg-muted-foreground" /> Deploy
				</span>
				<ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={v => v && setRange(v as Range)} aria-label="Time range">
					{Object.keys(ranges).map(k => (
						<ToggleGroupItem key={k} value={k} className="px-3 text-xs">
							{k}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<MetricCard title="CPU" value={`${last.cpu}m`} limit="limit 500m" pct={last.cpu / 500}>
					<ChartContainer config={cpuConfig} className="aspect-auto h-36 w-full">
						<AreaChart data={data} margin={{ left: 0, right: 4, top: 6 }}>
							<CartesianGrid vertical={false} stroke="var(--border)" />
							<XAxis dataKey="t" {...axis} minTickGap={40} />
							<YAxis {...axis} width={48} tickFormatter={v => `${v}m`} />
							{deployLabel && <ReferenceLine x={deployLabel} stroke="var(--muted-foreground)" strokeOpacity={0.6} />}
							<ChartTooltip cursor={{ stroke: 'var(--border)' }} content={<ChartTooltipContent indicator="line" />} />
							<Area dataKey="cpu" type="monotone" stroke="var(--color-cpu)" strokeWidth={2} fill="var(--color-cpu)" fillOpacity={0.1} />
						</AreaChart>
					</ChartContainer>
				</MetricCard>

				<MetricCard title="Memory" value={`${last.mem} MiB`} limit="limit 512 MiB" pct={last.mem / 512}>
					<ChartContainer config={memConfig} className="aspect-auto h-36 w-full">
						<AreaChart data={data} margin={{ left: 0, right: 4, top: 6 }}>
							<CartesianGrid vertical={false} stroke="var(--border)" />
							<XAxis dataKey="t" {...axis} minTickGap={40} />
							<YAxis {...axis} width={48} tickFormatter={v => `${v}`} />
							{deployLabel && <ReferenceLine x={deployLabel} stroke="var(--muted-foreground)" strokeOpacity={0.6} />}
							<ChartTooltip cursor={{ stroke: 'var(--border)' }} content={<ChartTooltipContent indicator="line" />} />
							<Area dataKey="mem" type="monotone" stroke="var(--color-mem)" strokeWidth={2} fill="var(--color-mem)" fillOpacity={0.1} />
						</AreaChart>
					</ChartContainer>
				</MetricCard>

				<MetricCard
					title="Network"
					value={
						<span className="flex items-center gap-3">
							<span className="inline-flex items-center gap-0.5">
								<ArrowDownIcon className="size-3.5 text-muted-foreground" />
								{last.rx} KB/s
							</span>
							<span className="inline-flex items-center gap-0.5">
								<ArrowUpIcon className="size-3.5 text-muted-foreground" />
								{last.tx} KB/s
							</span>
						</span>
					}
				>
					<ChartContainer config={netConfig} className="aspect-auto h-36 w-full">
						<LineChart data={data} margin={{ left: 0, right: 4, top: 6 }}>
							<CartesianGrid vertical={false} stroke="var(--border)" />
							<XAxis dataKey="t" {...axis} minTickGap={40} />
							<YAxis {...axis} width={48} />
							<ChartTooltip cursor={{ stroke: 'var(--border)' }} content={<ChartTooltipContent indicator="line" />} />
							<ChartLegend content={<ChartLegendContent />} verticalAlign="top" height={24} />
							<Line dataKey="rx" type="monotone" stroke="var(--color-rx)" strokeWidth={2} dot={false} strokeLinecap="round" />
							<Line dataKey="tx" type="monotone" stroke="var(--color-tx)" strokeWidth={2} dot={false} strokeLinecap="round" />
						</LineChart>
					</ChartContainer>
				</MetricCard>

				<MetricCard title="Persistent volumes">
					{service.volume ? (
						<div className="space-y-3 pt-2">
							<div className="flex items-center gap-2 text-sm">
								<HardDriveIcon className="size-4 text-muted-foreground" />
								<span className="font-mono">{service.volume.name}</span>
								<span className="ml-auto text-muted-foreground">
									{((parseInt(service.volume.size) * service.volume.usedPct) / 100).toFixed(1)} / {service.volume.size}
								</span>
							</div>
							<Meter pct={service.volume.usedPct / 100} />
							<div className="font-mono text-xs text-muted-foreground">{service.volume.mountPath}</div>
						</div>
					) : (
						<div className="flex h-36 items-center justify-center text-sm text-muted-foreground">No volumes attached</div>
					)}
				</MetricCard>
			</div>
		</div>
	);
}

function Meter({ pct }: { pct: number }) {
	return (
		<div className="h-1.5 overflow-hidden rounded-full bg-muted">
			<div
				className={cn('h-full rounded-full', pct > 0.9 ? 'bg-destructive' : pct > 0.7 ? 'bg-warning' : 'bg-primary')}
				style={{ width: `${Math.min(100, pct * 100)}%` }}
			/>
		</div>
	);
}

function MetricCard({
	title,
	value,
	limit,
	pct,
	children
}: {
	title: string;
	value?: React.ReactNode;
	limit?: string;
	pct?: number;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-lg border p-4">
			<div className="flex items-baseline gap-2">
				<h3 className="text-xs text-muted-foreground">{title}</h3>
				{limit && <span className="ml-auto text-[11px] text-muted-foreground">{limit}</span>}
			</div>
			{value && <div className="mt-1 text-lg font-semibold tracking-tight">{value}</div>}
			{pct !== undefined && (
				<div className="mt-2">
					<Meter pct={pct} />
				</div>
			)}
			<div className="mt-3">{children}</div>
		</section>
	);
}
