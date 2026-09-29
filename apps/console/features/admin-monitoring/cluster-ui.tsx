'use client';

import {
	BanIcon,
	CircleCheckIcon,
	CircleXIcon,
	CpuIcon,
	HardDriveIcon,
	MemoryStickIcon,
	OctagonAlertIcon,
	SearchIcon,
	TriangleAlertIcon,
	type LucideIcon
} from 'lucide-react';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ClusterEvent, ClusterMeter } from '@/lib/api/types';
import { formatRelative, percentOf } from '@/lib/format';
import type { MetricPoint, MetricsRange } from '@/lib/metrics-chart';
import { cn } from '@/lib/utils';
import { SEVERITY_BAR } from '@/lib/usage';
import { eventObject, filterEvents, usageSeverity, type NodeBadge, type Severity } from './model';

export type Format = (value: number) => string;

export const formatCount: Format = value => String(Math.round(value));

const severityStyles: Record<Severity, { bar: string; text: string; icon: LucideIcon | null }> = {
	unknown: { bar: SEVERITY_BAR.unknown, text: 'text-muted-foreground', icon: null },
	normal: { bar: SEVERITY_BAR.normal, text: 'text-muted-foreground', icon: null },
	high: { bar: SEVERITY_BAR.high, text: 'text-warning', icon: TriangleAlertIcon },
	critical: { bar: SEVERITY_BAR.critical, text: 'text-destructive', icon: OctagonAlertIcon }
};

const usedPercent = (meter: ClusterMeter) => (meter.used == null ? null : percentOf(meter.used, meter.capacity));
const requestedPercent = (meter: ClusterMeter) => (meter.requested == null ? null : percentOf(meter.requested, meter.capacity));
const valueText = (value: number | null, format: Format) => (value == null ? '—' : format(value));
const capacityText = (meter: ClusterMeter, format: Format) => (meter.capacity > 0 ? format(meter.capacity) : '—');

// The request line is a threshold, not a second fill: it marks what the scheduler has already promised away.
function RequestLine({ percent, className }: { percent: number | null; className?: string }) {
	if (percent == null) return null;
	return <span className={cn('absolute w-0.5 rounded-full bg-foreground', className)} style={{ left: `calc(${percent}% - 1px)` }} aria-hidden />;
}

export function Meter({ meter, className }: { meter: ClusterMeter; className?: string }) {
	const percent = usedPercent(meter);
	return (
		<div className={cn('relative h-1.5 rounded-full bg-foreground/10', className)}>
			{percent != null && (
				<div
					className={cn('h-full rounded-full transition-[width] duration-500', severityStyles[usageSeverity(percent)].bar)}
					style={{ width: `${percent}%` }}
				/>
			)}
			<RequestLine percent={requestedPercent(meter)} className="-top-1 -bottom-1" />
		</div>
	);
}

export function MiniMeter({ meter, format, label }: { meter: ClusterMeter; format: Format; label: string }) {
	const percent = usedPercent(meter);
	const severity = usageSeverity(percent);
	const detail = `${valueText(meter.used, format)} / ${capacityText(meter, format)}`;
	return (
		<div className="flex items-center gap-2" title={detail} aria-label={`${label} ${detail}`}>
			<Meter meter={meter} className="w-16" />
			<span className={cn('w-9 text-right text-xs tabular-nums', severityStyles[severity].text)}>
				{percent == null ? '—' : `${Math.round(percent)}%`}
			</span>
		</div>
	);
}

function SeverityTag({ percent }: { percent: number | null }) {
	if (percent == null) return null;
	const style = severityStyles[usageSeverity(percent)];
	return (
		<span className={cn('inline-flex items-center gap-1 text-xs font-medium tabular-nums', style.text)}>
			{style.icon && <style.icon className="size-3.5" />}
			{Math.round(percent)}%
		</span>
	);
}

export type WorkloadSplit = { platform: number; tenants: number; other: number };

const splitKeys = [
	{ key: 'platform', label: 'Platform', color: 'var(--chart-1)' },
	{ key: 'tenants', label: 'Tenants', color: 'var(--chart-2)' },
	{ key: 'other', label: 'Other', color: 'var(--chart-3)' }
] as const;

function SplitBar({ meter, split, format }: { meter: ClusterMeter; split: WorkloadSplit; format: Format }) {
	return (
		<div className="relative mt-3 flex h-4 items-center gap-0.5">
			{splitKeys.map(segment => (
				<Tooltip key={segment.key}>
					<TooltipTrigger asChild>
						<div className="flex h-full items-center" style={{ width: `${percentOf(split[segment.key], meter.capacity) ?? 0}%`, minWidth: 3 }}>
							<span className="h-2 w-full rounded-[2px]" style={{ background: segment.color }} />
						</div>
					</TooltipTrigger>
					<TooltipContent>
						{segment.label} · {format(split[segment.key])}
					</TooltipContent>
				</Tooltip>
			))}
			<span className="h-2 flex-1 rounded-[2px] bg-foreground/10" />
			<RequestLine percent={requestedPercent(meter)} className="inset-y-0" />
		</div>
	);
}

function RequestedRow({ meter, format }: { meter: ClusterMeter; format: Format }) {
	if (meter.requested == null) return null;
	return (
		<>
			<span className="flex w-2 justify-center" aria-hidden>
				<span className="h-2.5 w-0.5 rounded-full bg-foreground" />
			</span>
			<span className="text-muted-foreground">Requested</span>
			<span className="ml-auto tabular-nums">
				{format(meter.requested)} <span className="text-muted-foreground">· {Math.round(requestedPercent(meter) ?? 0)}%</span>
			</span>
		</>
	);
}

// Capacity tile; the platform/tenants/other split only exists for current CPU and memory, so it is optional.
export function ResourceTile({ label, meter, format, split }: { label: string; meter: ClusterMeter; format: Format; split?: WorkloadSplit }) {
	const hasSplit = split !== undefined && split.platform + split.tenants + split.other > 0 && meter.capacity > 0;
	const free = meter.used != null && meter.capacity > 0 ? `${format(Math.max(0, meter.capacity - meter.used))} free` : null;
	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				{label}
				<SeverityTag percent={usedPercent(meter)} />
			</div>
			<div className="mt-2 flex flex-wrap items-baseline gap-1">
				<span className="text-2xl font-semibold tracking-tight tabular-nums">{valueText(meter.used, format)}</span>
				<span className="text-sm text-muted-foreground">/ {capacityText(meter, format)}</span>
			</div>
			{hasSplit ? (
				<>
					<SplitBar meter={meter} split={split} format={format} />
					<dl className="mt-3 space-y-1 text-xs">
						{splitKeys.map(segment => (
							<div key={segment.key} className="flex items-center gap-2">
								<span className="size-2 rounded-[2px]" style={{ background: segment.color }} aria-hidden />
								<dt className="text-muted-foreground">{segment.label}</dt>
								<dd className="ml-auto tabular-nums">{format(split[segment.key])}</dd>
							</div>
						))}
						{meter.requested != null && (
							<div className="flex items-center gap-2 border-t pt-1.5">
								<RequestedRow meter={meter} format={format} />
							</div>
						)}
					</dl>
				</>
			) : (
				<>
					<Meter meter={meter} className="mt-3" />
					<div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
						{meter.requested == null ? (free ?? 'Not measured') : <RequestedRow meter={meter} format={format} />}
					</div>
				</>
			)}
		</div>
	);
}

const badgeStyles: Record<NodeBadge, { icon: LucideIcon; className: string }> = {
	Ready: { icon: CircleCheckIcon, className: 'text-success' },
	NotReady: { icon: CircleXIcon, className: 'text-destructive' },
	Cordoned: { icon: BanIcon, className: 'text-muted-foreground' },
	MemoryPressure: { icon: MemoryStickIcon, className: 'text-warning' },
	DiskPressure: { icon: HardDriveIcon, className: 'text-warning' },
	PIDPressure: { icon: CpuIcon, className: 'text-warning' }
};

export function NodeBadges({ badges }: { badges: NodeBadge[] }) {
	return (
		<span className="flex flex-wrap items-center gap-1.5">
			{badges.map(badge => {
				const style = badgeStyles[badge];
				return (
					<span key={badge} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', style.className)}>
						<style.icon className="size-3" />
						{badge}
					</span>
				);
			})}
		</span>
	);
}

export function InfoStrip({ items, className }: { items: { label: string; value: React.ReactNode; hint?: React.ReactNode }[]; className?: string }) {
	return (
		<dl className={cn('grid gap-px overflow-hidden rounded-lg border bg-border', className)}>
			{items.map(item => (
				<div key={item.label} className="min-w-0 space-y-1 bg-card px-4 py-3">
					<dt className="text-xs text-muted-foreground">{item.label}</dt>
					<dd className="truncate text-sm font-medium">{item.value}</dd>
					{item.hint && <dd className="truncate text-xs text-muted-foreground">{item.hint}</dd>}
				</div>
			))}
		</dl>
	);
}

export function RangeToggle({ value, onChange }: { value: MetricsRange; onChange: (range: MetricsRange) => void }) {
	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			value={value}
			onValueChange={next => next && onChange(next as MetricsRange)}
			aria-label="Time range"
		>
			{(['1h', '24h', '7d'] as const).map(range => (
				<ToggleGroupItem key={range} value={range} className="px-3 text-xs">
					{range}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

const axis = { tickLine: false, axisLine: false, fontSize: 11, stroke: 'var(--muted-foreground)' } as const;

export function UsageChart({
	title,
	subtitle,
	points,
	format,
	formatTime,
	color = 'var(--primary-text)',
	limit
}: {
	title: string;
	subtitle?: React.ReactNode;
	points: MetricPoint[];
	format: Format;
	formatTime: (epochSec: number) => string;
	color?: string;
	limit?: { value: number; label: string };
}) {
	return (
		<section className="rounded-lg border bg-card p-4">
			<div className="flex items-baseline gap-2">
				<h3 className="text-sm font-medium">{title}</h3>
				{subtitle && <span className="ml-auto text-xs text-muted-foreground">{subtitle}</span>}
			</div>
			{points.length === 0 ? (
				<div className="mt-3 flex h-56 items-center justify-center text-xs text-muted-foreground">No data in range</div>
			) : (
				<ChartContainer config={{ v: { label: 'Used', color } }} className="mt-3 aspect-auto h-56 w-full">
					<AreaChart data={points} margin={{ left: 0, right: 4, top: 6 }}>
						<CartesianGrid vertical={false} stroke="var(--border)" />
						<XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={formatTime} minTickGap={48} {...axis} />
						<YAxis tickFormatter={format} width={84} {...axis} />
						{limit && (
							<ReferenceLine
								y={limit.value}
								ifOverflow="extendDomain"
								stroke="var(--muted-foreground)"
								strokeDasharray="4 4"
								strokeOpacity={0.7}
								label={{ value: limit.label, position: 'insideTopRight', fill: 'var(--muted-foreground)', fontSize: 11 }}
							/>
						)}
						<ChartTooltip
							cursor={{ stroke: 'var(--border)' }}
							content={
								<ChartTooltipContent
									indicator="line"
									labelFormatter={(_, payload) => {
										const t: unknown = payload[0]?.payload?.t;
										return typeof t === 'number' ? formatTime(t) : null;
									}}
									formatter={value => (
										<div className="flex w-full items-center justify-between gap-4">
											<span className="text-muted-foreground">Used</span>
											<span className="font-mono font-medium tabular-nums">{format(Number(value))}</span>
										</div>
									)}
								/>
							}
						/>
						<Area
							dataKey="v"
							type="monotone"
							stroke="var(--color-v)"
							strokeWidth={2}
							fill="var(--color-v)"
							fillOpacity={0.1}
							dot={points.length === 1}
							isAnimationActive={false}
							activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
						/>
					</AreaChart>
				</ChartContainer>
			)}
		</section>
	);
}

export function EventsList({ events, filterable, empty }: { events: ClusterEvent[]; filterable?: boolean; empty: string }) {
	const [query, setQuery] = useState('');
	const shown = filterable ? filterEvents(events, query) : events;
	return (
		<div className="space-y-3">
			{filterable && (
				<div className="flex flex-wrap items-center gap-2">
					<div className="relative w-full max-w-xs">
						<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={event => setQuery(event.target.value)}
							placeholder="Filter by reason, object, message…"
							aria-label="Filter events"
							className="h-8 pl-8"
						/>
					</div>
					<span className="ml-auto text-xs text-muted-foreground tabular-nums">
						{shown.length} of {events.length} events
					</span>
				</div>
			)}
			<ul className="divide-y overflow-hidden rounded-lg border bg-card">
				{shown.map(event => (
					<li key={event.id} className="flex gap-3 bg-warning/[0.06] px-4 py-3">
						<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warning" />
						<div className="min-w-0 flex-1 space-y-1">
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
								<span className="font-medium">{event.reason || 'Warning'}</span>
								{eventObject(event) && <span className="truncate font-mono text-xs text-muted-foreground">{eventObject(event)}</span>}
								<span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
									{event.count > 1 && <span className="rounded border px-1.5 font-mono">×{event.count}</span>}
									{formatRelative(event.lastSeen, '—')}
								</span>
							</div>
							<p className="text-sm break-words text-muted-foreground">{event.message}</p>
						</div>
					</li>
				))}
				{shown.length === 0 && (
					<li className="px-4 py-10 text-center text-sm text-muted-foreground">{events.length === 0 ? empty : 'No events match this filter.'}</li>
				)}
			</ul>
			<p className="text-xs text-muted-foreground">Kubernetes prunes events after about an hour, so this list covers roughly the last hour.</p>
		</div>
	);
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-14 text-center">
			<span className="flex size-9 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
				<Icon className="size-4" />
			</span>
			<p className="text-sm font-medium">{title}</p>
			<p className="max-w-sm text-sm text-muted-foreground">{description}</p>
		</div>
	);
}
