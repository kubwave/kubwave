'use client';

import { apiData } from '@kubwave/api-client';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownIcon, ArrowUpIcon, HardDriveIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import type { Service, ServiceMetrics } from '@/lib/api/types';
import { formatBytes, percentOf } from '@/lib/format';
import { pollIntervalForRange, type MetricPoint, type MetricsRange } from '@/lib/metrics-chart';
import { formatCpu, formatRate, makeMetricsTimeFormatter } from '@/lib/metrics-format';
import { SEVERITY_BAR, usageSeverity } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { appendLiveSample, liveSeries, type LiveSample, type LiveSeries } from './buffers';
import { useServiceDeployments } from './use-deployments';

const RANGES: MetricsRange[] = ['1h', '24h', '7d'];
// About 15 minutes of history at the 10s live poll.
const MAX_LIVE_SAMPLES = 90;

const cpuConfig = { v: { label: 'CPU', color: 'var(--chart-1)' } } satisfies ChartConfig;
const memConfig = { v: { label: 'Memory', color: 'var(--chart-1)' } } satisfies ChartConfig;
const netConfig = { rx: { label: 'Inbound', color: 'var(--chart-1)' }, tx: { label: 'Outbound', color: 'var(--chart-2)' } } satisfies ChartConfig;
const axis = { tickLine: false, axisLine: false, fontSize: 11, stroke: 'var(--muted-foreground)' } as const;

// Live (kubelet) mode returns one point per poll and is buffered here; historical mode (Prometheus)
// carries its own series. Polling follows the mode and range.
function useServiceMetrics(serviceId: string, range: MetricsRange) {
	const [samples, setSamples] = useState<LiveSample[]>([]);
	const metrics = useQuery({
		queryKey: queryKeys.serviceMetrics(serviceId, range),
		queryFn: () => apiData(getBrowserApi().services(serviceId).metrics.get({ range })),
		refetchInterval: query => (query.state.data?.mode === 'live' ? 10_000 : pollIntervalForRange(range))
	});
	const data = metrics.data;
	useEffect(() => {
		if (data?.mode === 'live' && data.available) setSamples(current => appendLiveSample(current, data, MAX_LIVE_SAMPLES));
	}, [data]);
	const series: LiveSeries | undefined = data?.mode === 'live' ? liveSeries(samples) : data?.series;
	return { metrics: data, series, isPending: metrics.isPending };
}

function mergeNetwork(rx: MetricPoint[], tx: MetricPoint[]) {
	const byTime = new Map<number, { t: number; rx?: number; tx?: number }>();
	for (const point of rx) byTime.set(point.t, { ...byTime.get(point.t), t: point.t, rx: point.v });
	for (const point of tx) byTime.set(point.t, { ...byTime.get(point.t), t: point.t, tx: point.v });
	return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function MetricsTab({ service }: { service: Service }) {
	const [range, setRange] = useState<MetricsRange>('1h');
	const { metrics, series, isPending } = useServiceMetrics(service.id, range);
	const { deployments } = useServiceDeployments(service.id, service.environmentId);

	if (isPending)
		return (
			<div className="flex h-40 items-center justify-center text-muted-foreground">
				<LoaderCircleIcon className="size-4 animate-spin" />
			</div>
		);
	if (!metrics?.available || !series)
		return (
			<div className="rounded-lg border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
				No metrics yet. Deploy the service to start collecting.
			</div>
		);

	const formatTime = makeMetricsTimeFormatter(range);
	const cpu = series.cpuMillicores;
	const domainStart = cpu[0]?.t ?? 0;
	const domainEnd = cpu.at(-1)?.t ?? 0;
	const deployTimes = deployments
		.map(deployment => Math.floor(Date.parse(deployment.createdAt) / 1000))
		.filter(at => Number.isFinite(at) && at >= domainStart && at <= domainEnd);
	const markers = deployTimes.map(at => <ReferenceLine key={at} x={at} stroke="var(--muted-foreground)" strokeOpacity={0.6} />);
	const live = metrics.mode === 'live';
	const rx = live ? (series.networkRxBytes.at(-1)?.v ?? null) : metrics.current.networkRxBytes;
	const tx = live ? (series.networkTxBytes.at(-1)?.v ?? null) : metrics.current.networkTxBytes;
	const xAxis = <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatTime} {...axis} minTickGap={40} />;

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<div className="mr-auto text-xs text-muted-foreground">
					<span className="font-medium text-foreground">{live ? 'Live' : 'Historical'}</span> · {live ? 'kubelet' : 'Prometheus'} · {metrics.replicas}{' '}
					{metrics.replicas === 1 ? 'pod' : 'pods'}
				</div>
				{deployTimes.length > 0 && (
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span className="h-3 w-px bg-muted-foreground" /> Deploy
					</span>
				)}
				{!live && (
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={range}
						onValueChange={value => value && setRange(value as MetricsRange)}
						aria-label="Time range"
					>
						{RANGES.map(option => (
							<ToggleGroupItem key={option} value={option} className="px-3 text-xs">
								{option}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				)}
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<MetricCard
					title="CPU"
					value={formatCpu(metrics.current.cpuMillicores)}
					limit={metrics.limits.cpuMillicores}
					format={formatCpu}
					used={metrics.current.cpuMillicores}
				>
					<ChartContainer config={cpuConfig} className="aspect-auto h-36 w-full">
						<AreaChart data={cpu} margin={{ left: 0, right: 4, top: 6 }}>
							<CartesianGrid vertical={false} stroke="var(--border)" />
							{xAxis}
							<YAxis {...axis} width={52} tickFormatter={formatCpu} />
							{markers}
							<ChartTooltip
								cursor={{ stroke: 'var(--border)' }}
								content={<ChartTooltipContent indicator="line" labelFormatter={(_, payload) => formatTime(Number(payload[0]?.payload?.t))} />}
							/>
							<Area
								dataKey="v"
								type="monotone"
								stroke="var(--color-v)"
								strokeWidth={2}
								fill="var(--color-v)"
								fillOpacity={0.1}
								isAnimationActive={false}
							/>
						</AreaChart>
					</ChartContainer>
				</MetricCard>

				<MetricCard
					title="Memory"
					value={formatBytes(metrics.current.memoryBytes)}
					limit={metrics.limits.memoryBytes}
					format={formatBytes}
					used={metrics.current.memoryBytes}
				>
					<ChartContainer config={memConfig} className="aspect-auto h-36 w-full">
						<AreaChart data={series.memoryBytes} margin={{ left: 0, right: 4, top: 6 }}>
							<CartesianGrid vertical={false} stroke="var(--border)" />
							{xAxis}
							<YAxis {...axis} width={52} tickFormatter={formatBytes} />
							{markers}
							<ChartTooltip
								cursor={{ stroke: 'var(--border)' }}
								content={<ChartTooltipContent indicator="line" labelFormatter={(_, payload) => formatTime(Number(payload[0]?.payload?.t))} />}
							/>
							<Area
								dataKey="v"
								type="monotone"
								stroke="var(--color-v)"
								strokeWidth={2}
								fill="var(--color-v)"
								fillOpacity={0.1}
								isAnimationActive={false}
							/>
						</AreaChart>
					</ChartContainer>
				</MetricCard>

				<MetricCard
					title="Network"
					value={
						<span className="flex items-center gap-3">
							<span className="inline-flex items-center gap-0.5">
								<ArrowDownIcon className="size-3.5 text-muted-foreground" />
								{formatRate(rx)}
							</span>
							<span className="inline-flex items-center gap-0.5">
								<ArrowUpIcon className="size-3.5 text-muted-foreground" />
								{formatRate(tx)}
							</span>
						</span>
					}
				>
					<ChartContainer config={netConfig} className="aspect-auto h-36 w-full">
						<LineChart data={mergeNetwork(series.networkRxBytes, series.networkTxBytes)} margin={{ left: 0, right: 4, top: 6 }}>
							<CartesianGrid vertical={false} stroke="var(--border)" />
							{xAxis}
							<YAxis {...axis} width={52} tickFormatter={value => formatRate(Number(value))} />
							<ChartTooltip
								cursor={{ stroke: 'var(--border)' }}
								content={<ChartTooltipContent indicator="line" labelFormatter={(_, payload) => formatTime(Number(payload[0]?.payload?.t))} />}
							/>
							<ChartLegend content={<ChartLegendContent />} verticalAlign="top" height={24} />
							<Line dataKey="rx" type="monotone" stroke="var(--color-rx)" strokeWidth={2} dot={false} isAnimationActive={false} />
							<Line dataKey="tx" type="monotone" stroke="var(--color-tx)" strokeWidth={2} dot={false} isAnimationActive={false} />
						</LineChart>
					</ChartContainer>
				</MetricCard>

				<VolumesCard service={service} metrics={metrics} />
			</div>
		</div>
	);
}

function VolumesCard({ service, metrics }: { service: Service; metrics: ServiceMetrics }) {
	const volumes = metrics.current.volumes;
	return (
		<MetricCard title="Persistent volumes">
			{volumes.length === 0 ? (
				<div className="flex h-36 items-center justify-center text-sm text-muted-foreground">No volumes attached</div>
			) : (
				<div className="space-y-4 pt-2">
					{volumes.map(volume => {
						const mount = service.config.volumes.find(configured => configured.name === volume.name)?.mountPath;
						return (
							<div key={volume.name} className="space-y-2">
								<div className="flex items-center gap-2 text-sm">
									<HardDriveIcon className="size-4 text-muted-foreground" />
									<span className="font-mono">{volume.name}</span>
									<span className="ml-auto text-muted-foreground">
										{formatBytes(volume.usedBytes)} / {formatBytes(volume.capacityBytes)}
									</span>
								</div>
								<Meter pct={(percentOf(volume.usedBytes, volume.capacityBytes) ?? 0) / 100} />
								{mount && <div className="font-mono text-xs text-muted-foreground">{mount}</div>}
							</div>
						);
					})}
				</div>
			)}
		</MetricCard>
	);
}

function Meter({ pct }: { pct: number }) {
	return (
		<div className="h-1.5 overflow-hidden rounded-full bg-muted">
			<div className={cn('h-full rounded-full', SEVERITY_BAR[usageSeverity(pct * 100)])} style={{ width: `${Math.min(100, pct * 100)}%` }} />
		</div>
	);
}

function MetricCard({
	title,
	value,
	limit,
	used,
	format,
	children
}: {
	title: string;
	value?: React.ReactNode;
	limit?: number | null;
	used?: number;
	format?: (value: number) => string;
	children: React.ReactNode;
}) {
	const pct = limit && used !== undefined ? used / limit : undefined;
	return (
		<section className="rounded-lg border p-4">
			<div className="flex items-baseline gap-2">
				<h3 className="text-xs text-muted-foreground">{title}</h3>
				{limit && format && <span className="ml-auto text-[11px] text-muted-foreground">limit {format(limit)}</span>}
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
