'use client';

import {
	BanIcon,
	CircleCheckIcon,
	CircleXIcon,
	HardDriveIcon,
	InfoIcon,
	MemoryStickIcon,
	OctagonAlertIcon,
	SearchIcon,
	TriangleAlertIcon
} from 'lucide-react';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ClusterEvent, ClusterResource, NodeBadge, Range, Usage } from '@/lib/mock-admin';
import { cn } from '@/lib/utils';

export const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pctOf = (v: number, max: number) => Math.round((v / max) * 100);

function severity(pct: number) {
	if (pct > 90) return { bar: 'bg-destructive', text: 'text-destructive', icon: OctagonAlertIcon, label: 'Critical' };
	if (pct >= 70) return { bar: 'bg-warning', text: 'text-warning', icon: TriangleAlertIcon, label: 'High' };
	return { bar: 'bg-primary', text: 'text-muted-foreground', icon: null, label: 'Normal' };
}

export function Meter({ value, max, requested, className }: { value: number; max: number; requested?: number; className?: string }) {
	const pct = pctOf(value, max);
	return (
		<div className={cn('relative h-1.5 rounded-full bg-foreground/10', className)}>
			<div className={cn('h-full rounded-full', severity(pct).bar)} style={{ width: `${Math.min(100, pct)}%` }} />
			{requested !== undefined && (
				<span
					className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground"
					style={{ left: `calc(${Math.min(100, pctOf(requested, max))}% - 1px)` }}
					aria-hidden
				/>
			)}
		</div>
	);
}

export function MiniMeter({ value, max, label }: { value: number; max: number; label: string }) {
	const pct = pctOf(value, max);
	const s = severity(pct);
	return (
		<div className="flex items-center gap-2" aria-label={`${label} ${pct}%`}>
			<Meter value={value} max={max} className="w-16" />
			<span className={cn('w-9 text-right text-xs tabular-nums', pct >= 70 ? s.text : 'text-muted-foreground')}>{pct}%</span>
		</div>
	);
}

function SeverityTag({ pct }: { pct: number }) {
	const s = severity(pct);
	return (
		<span className={cn('inline-flex items-center gap-1 text-xs font-medium tabular-nums', s.icon ? s.text : 'text-muted-foreground')}>
			{s.icon && <s.icon className="size-3.5" aria-label={s.label} />}
			{pct}%
		</span>
	);
}

const splitKeys = [
	{ key: 'platform', label: 'Platform', color: 'var(--chart-1)' },
	{ key: 'tenants', label: 'Tenants', color: 'var(--chart-2)' },
	{ key: 'other', label: 'Other', color: 'var(--chart-3)' }
] as const;

export const splitConfig = Object.fromEntries(splitKeys.map(s => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig;

export function SplitMeterTile({ resource }: { resource: ClusterResource }) {
	const { usage, split, unit, label } = resource;
	const pct = pctOf(usage.used, usage.capacity);
	const reqPct = usage.requested !== undefined ? pctOf(usage.requested, usage.capacity) : undefined;
	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				{label}
				<SeverityTag pct={pct} />
			</div>
			<div className="mt-2 flex items-baseline gap-1">
				<span className="text-2xl font-semibold tracking-tight tabular-nums">{fmt(usage.used)}</span>
				<span className="text-sm text-muted-foreground">
					/ {fmt(usage.capacity)} {unit}
				</span>
			</div>
			<div
				className="relative mt-3 flex h-4 items-center gap-0.5"
				role="img"
				aria-label={`${label}: ${fmt(usage.used)} of ${fmt(usage.capacity)} ${unit} used. ${splitKeys.map(s => `${s.label} ${fmt(split[s.key])}`).join(', ')}.`}
			>
				{splitKeys.map(s => (
					<Tooltip key={s.key}>
						<TooltipTrigger asChild>
							<div
								className="flex h-full items-center first:[&>span]:rounded-l-full"
								style={{ width: `${(split[s.key] / usage.capacity) * 100}%`, minWidth: 3 }}
							>
								<span className="h-2 w-full rounded-[2px]" style={{ background: s.color }} />
							</div>
						</TooltipTrigger>
						<TooltipContent>
							{s.label} · {fmt(split[s.key])} {unit} · {pctOf(split[s.key], usage.capacity)}%
						</TooltipContent>
					</Tooltip>
				))}
				<span className="h-2 flex-1 rounded-[2px] rounded-r-full bg-foreground/10" />
				{reqPct !== undefined && (
					<span
						className="absolute inset-y-0 w-0.5 rounded-full bg-foreground"
						style={{ left: `calc(${Math.min(100, reqPct)}% - 1px)` }}
						aria-hidden
					/>
				)}
			</div>
			<dl className="mt-3 space-y-1 text-xs">
				{splitKeys.map(s => (
					<div key={s.key} className="flex items-center gap-2">
						<span className="size-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />
						<dt className="text-muted-foreground">{s.label}</dt>
						<dd className="ml-auto tabular-nums">{fmt(split[s.key])}</dd>
					</div>
				))}
				{usage.requested !== undefined && (
					<div className="flex items-center gap-2 border-t pt-1.5">
						<span className="flex w-2 justify-center" aria-hidden>
							<span className="h-2.5 w-0.5 rounded-full bg-foreground" />
						</span>
						<dt className="text-muted-foreground">Requested</dt>
						<dd className="ml-auto tabular-nums">
							{fmt(usage.requested)} <span className="text-muted-foreground">· {reqPct}%</span>
						</dd>
					</div>
				)}
			</dl>
		</div>
	);
}

export function ResourceTile({ label, usage, unit }: { label: string; usage: Usage; unit: string }) {
	const pct = pctOf(usage.used, usage.capacity);
	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				{label}
				<SeverityTag pct={pct} />
			</div>
			<div className="mt-2 flex items-baseline gap-1">
				<span className="text-2xl font-semibold tracking-tight tabular-nums">{fmt(usage.used)}</span>
				<span className="text-sm text-muted-foreground">
					/ {fmt(usage.capacity)} {unit}
				</span>
			</div>
			<Meter value={usage.used} max={usage.capacity} requested={usage.requested} className="mt-3" />
			<div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
				{usage.requested === undefined ? (
					`${fmt(usage.capacity - usage.used)} ${unit} free`
				) : (
					<>
						<span className="h-2.5 w-0.5 rounded-full bg-foreground" aria-hidden />
						Requested <span className="text-foreground tabular-nums">{fmt(usage.requested)}</span> · {pctOf(usage.requested, usage.capacity)}%
					</>
				)}
			</div>
		</div>
	);
}

const badgeStyle: Record<NodeBadge, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
	Ready: { icon: CircleCheckIcon, className: 'text-success' },
	NotReady: { icon: CircleXIcon, className: 'text-destructive' },
	Cordoned: { icon: BanIcon, className: 'text-muted-foreground' },
	MemoryPressure: { icon: MemoryStickIcon, className: 'text-warning' },
	DiskPressure: { icon: HardDriveIcon, className: 'text-warning' }
};

export function NodeBadges({ badges }: { badges: NodeBadge[] }) {
	return (
		<span className="flex flex-wrap items-center gap-1.5">
			{badges.map(b => {
				const s = badgeStyle[b];
				return (
					<span key={b} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', s.className)}>
						<s.icon className="size-3" />
						{b}
					</span>
				);
			})}
		</span>
	);
}

export function InfoStrip({ items, className }: { items: { label: string; value: React.ReactNode; hint?: React.ReactNode }[]; className?: string }) {
	return (
		<dl className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4', className)}>
			{items.map(i => (
				<div key={i.label} className="min-w-0 space-y-1 bg-card px-4 py-3">
					<dt className="text-xs text-muted-foreground">{i.label}</dt>
					<dd className="truncate text-sm font-medium">{i.value}</dd>
					{i.hint && <dd className="truncate text-xs text-muted-foreground">{i.hint}</dd>}
				</div>
			))}
		</dl>
	);
}

export function RangeToggle({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
	return (
		<ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={v => v && onChange(v as Range)} aria-label="Time range">
			{(['1h', '24h', '7d'] as const).map(r => (
				<ToggleGroupItem key={r} value={r} className="px-3 text-xs">
					{r}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

const axis = { tickLine: false, axisLine: false, fontSize: 11, stroke: 'var(--muted-foreground)' } as const;

export function UsageChart({
	title,
	subtitle,
	data,
	config,
	unit,
	limit
}: {
	title: string;
	subtitle?: React.ReactNode;
	data: Record<string, string | number>[];
	config: ChartConfig;
	unit?: string;
	limit?: { value: number; label: string };
}) {
	const keys = Object.keys(config);
	return (
		<section className="rounded-lg border bg-card p-4">
			<div className="flex items-baseline gap-2">
				<h3 className="text-sm font-medium">{title}</h3>
				{subtitle && <span className="ml-auto text-xs text-muted-foreground">{subtitle}</span>}
			</div>
			<ChartContainer config={config} className="mt-3 aspect-auto h-56 w-full">
				<AreaChart data={data} margin={{ left: -8, right: 4, top: 6 }}>
					<CartesianGrid vertical={false} stroke="var(--border)" />
					<XAxis dataKey="t" {...axis} minTickGap={48} />
					<YAxis {...axis} width={unit ? 60 : 40} tickFormatter={v => (unit ? `${v} ${unit}` : String(v))} />
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
					<ChartTooltip cursor={{ stroke: 'var(--border)' }} content={<ChartTooltipContent indicator="line" />} />
					{keys.length > 1 && <ChartLegend content={<ChartLegendContent />} verticalAlign="top" height={28} />}
					{keys.map(k => (
						<Area
							key={k}
							dataKey={k}
							type="monotone"
							stroke={`var(--color-${k})`}
							strokeWidth={2}
							fill={`var(--color-${k})`}
							fillOpacity={0.1}
							activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
						/>
					))}
				</AreaChart>
			</ChartContainer>
		</section>
	);
}

export function EventsList({ events, filterable, empty }: { events: ClusterEvent[]; filterable?: boolean; empty?: React.ReactNode }) {
	const [query, setQuery] = useState('');
	const [type, setType] = useState<'all' | 'Warning'>('all');
	const q = query.trim().toLowerCase();
	const shown = events.filter(
		e => (type === 'all' || e.type === type) && (!q || `${e.reason} ${e.message} ${e.namespace} ${e.object}`.toLowerCase().includes(q))
	);
	const warnings = events.filter(e => e.type === 'Warning').length;

	return (
		<div className="space-y-3">
			{filterable && (
				<div className="flex flex-wrap items-center gap-2">
					<div className="relative w-full max-w-xs">
						<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="Filter by reason, object, message…"
							aria-label="Filter events"
							className="h-8 pl-8"
						/>
					</div>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={type}
						onValueChange={v => v && setType(v as typeof type)}
						aria-label="Event type"
					>
						<ToggleGroupItem value="all" className="px-3 text-xs">
							All
						</ToggleGroupItem>
						<ToggleGroupItem value="Warning" className="px-3 text-xs">
							Warnings <span className="text-muted-foreground tabular-nums">{warnings}</span>
						</ToggleGroupItem>
					</ToggleGroup>
					<span className="ml-auto text-xs text-muted-foreground tabular-nums">
						{shown.length} of {events.length} events
					</span>
				</div>
			)}
			<ul className="divide-y overflow-hidden rounded-lg border bg-card">
				{shown.map(e => {
					const warn = e.type === 'Warning';
					const Icon = warn ? TriangleAlertIcon : InfoIcon;
					return (
						<li key={e.id} className={cn('flex gap-3 px-4 py-3', warn && 'bg-warning/[0.06]')}>
							<Icon className={cn('mt-0.5 size-4 shrink-0', warn ? 'text-warning' : 'text-muted-foreground')} aria-label={e.type} />
							<div className="min-w-0 flex-1 space-y-1">
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
									<span className="font-medium">{e.reason}</span>
									<span className="truncate font-mono text-xs text-muted-foreground">
										{e.namespace}/{e.object}
									</span>
									<span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
										{e.count > 1 && <span className="rounded border px-1.5 font-mono">×{e.count}</span>}
										{e.lastSeen}
									</span>
								</div>
								<p className="text-sm break-words text-muted-foreground">{e.message}</p>
							</div>
						</li>
					);
				})}
				{!shown.length && <li className="px-4 py-10 text-center text-sm text-muted-foreground">{empty ?? 'No events match this filter.'}</li>}
			</ul>
		</div>
	);
}
