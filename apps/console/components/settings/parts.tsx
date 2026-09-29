'use client';

import { CircleAlertIcon, RotateCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function useHashSection(ids: readonly string[]) {
	const [section, setSection] = useState(ids[0]!);
	useEffect(() => {
		const sync = () => {
			const hash = window.location.hash.slice(1);
			if (ids.includes(hash)) setSection(hash);
		};
		sync();
		window.addEventListener('hashchange', sync);
		return () => window.removeEventListener('hashchange', sync);
	}, [ids]);
	const change = (id: string) => {
		setSection(id);
		history.replaceState(null, '', `#${id}`);
	};
	return [section, change] as const;
}

export const Count = ({ n }: { n: number }) => <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{n}</span>;

export function ListCard({
	title,
	description,
	action,
	children
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="overflow-hidden rounded-lg border bg-card">
			<header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
				<div className="min-w-0 flex-1 space-y-1">
					<h2 className="text-base font-semibold">{title}</h2>
					{description && <p className="text-sm text-muted-foreground">{description}</p>}
				</div>
				{action}
			</header>
			<ul className="divide-y">{children}</ul>
		</section>
	);
}

export function EmptyRow({
	icon: Icon,
	title,
	description
}: {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	description?: React.ReactNode;
}) {
	return (
		<li className="flex flex-col items-center gap-2 px-5 py-10 text-center">
			<span className="flex size-9 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
				<Icon className="size-4" />
			</span>
			<p className="text-sm font-medium">{title}</p>
			{description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
		</li>
	);
}

// A failed load, shown instead of an empty or default state so failures don't look like data.
export function LoadError({ what, onRetry, className }: { what: string; onRetry: () => void; className?: string }) {
	return (
		<div role="alert" className={cn('flex flex-col items-center gap-2 px-5 py-8 text-center', className)}>
			<span className="flex size-9 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
				<CircleAlertIcon className="size-4" />
			</span>
			<p className="text-sm font-medium">Could not load {what}.</p>
			<Button type="button" variant="outline" size="sm" onClick={onRetry}>
				<RotateCwIcon /> Retry
			</Button>
		</div>
	);
}

export function RowIcon({ icon: Icon, className }: { icon: React.ComponentType<{ className?: string }>; className?: string }) {
	return (
		<span className={cn('flex size-5 shrink-0 items-center justify-center text-muted-foreground', className)}>
			<Icon className="size-4" />
		</span>
	);
}

export function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0 space-y-1">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="flex min-h-6 items-center gap-1.5 text-sm">{children}</dd>
		</div>
	);
}

export function DangerRow({ title, description, children }: { title: string; description: React.ReactNode; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
			<div className="space-y-0.5">
				<p className="text-sm font-medium">{title}</p>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">{children}</div>
		</div>
	);
}

export function WithTooltip({ tip, children }: { tip?: string | false; children: React.ReactElement }) {
	if (!tip) return children;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
					{children}
				</span>
			</TooltipTrigger>
			<TooltipContent>{tip}</TooltipContent>
		</Tooltip>
	);
}

export function CopyField({ value, label, className }: { value: string; label: string; className?: string }) {
	return (
		<div className={cn('relative', className)}>
			<Input readOnly value={value} aria-label={label} className="pr-9 font-mono text-xs" onFocus={e => e.currentTarget.select()} />
			<div className="absolute top-1/2 right-1.5 -translate-y-1/2">
				<CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
			</div>
		</div>
	);
}

export function CodeBlock({ value, label = 'Copy', wrap }: { value: string; label?: string; wrap?: boolean }) {
	return (
		<div className="relative">
			<pre
				className={cn(
					'overflow-x-auto rounded-md border bg-muted/50 p-3 pr-10 font-mono text-xs leading-relaxed',
					wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'
				)}
			>
				{value}
			</pre>
			<div className="absolute top-2 right-2">
				<CopyButton value={value} label={label} />
			</div>
		</div>
	);
}
