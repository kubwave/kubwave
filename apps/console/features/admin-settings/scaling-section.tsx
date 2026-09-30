'use client';

import type { PlatformVolumeDto } from '@kubwave/api-client';
import { ChartLineIcon, DatabaseIcon, LoaderCircleIcon, PackageIcon } from 'lucide-react';
import { Field, Row, Suffixed } from '@/components/admin/form';
import { SettingsCard } from '@/components/settings-layout';
import { Input } from '@/components/ui/input';
import { LoadError } from '@/components/settings/parts';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { formatBytes, formatRelative, percentOf } from '@/lib/format';
import { SEVERITY_BAR, usageSeverity } from '@/lib/usage';
import { cn } from '@/lib/utils';
import type { ScalingGroups } from './use-settings-tabs';

const VOLUMES: Record<PlatformVolumeDto['volume'], { title: string; icon: React.ComponentType<{ className?: string }> }> = {
	postgres: { title: 'Platform database', icon: DatabaseIcon },
	registry: { title: 'Container registry', icon: PackageIcon },
	prometheus: { title: 'Managed Prometheus', icon: ChartLineIcon }
};

function Meter({ percent, marker }: { percent: number; marker?: number }) {
	const tone = SEVERITY_BAR[usageSeverity(percent)];
	return (
		<div className="relative h-1.5 rounded-full bg-foreground/10">
			<div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width: `${percent}%` }} />
			{marker !== undefined && (
				<span className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground" style={{ left: `calc(${marker}% - 1px)` }} aria-hidden />
			)}
		</div>
	);
}

export function ScalingSection({ groups }: { groups: ScalingGroups }) {
	const { ha, concurrency, prPreview, autoscaling } = groups;
	const failed = [ha, concurrency, prPreview, autoscaling].filter(group => group.failed);
	if (failed.length > 0)
		return <LoadError what="the scaling settings" onRetry={() => failed.forEach(group => group.retry())} className="rounded-lg border" />;
	if (![ha, concurrency, prPreview, autoscaling].every(group => group.loaded))
		return (
			<>
				<Skeleton className="h-56 rounded-lg" />
				<Skeleton className="h-64 rounded-lg" />
			</>
		);

	return (
		<>
			<SettingsCard title="Scaling" description="How the platform spreads load and how much work runs in parallel.">
				<div className="divide-y">
					<Row
						label="High availability"
						htmlFor="ha"
						description="Run api, console, worker and the CloudNativePG database as 3 replicas with soft anti-affinity. Smaller clusters still run; full spread needs at least 3 nodes."
					>
						<Switch id="ha" checked={ha.draft.enabled} onCheckedChange={enabled => ha.set({ enabled })} />
					</Row>
					<Row
						label="Max concurrent deployments"
						htmlFor="max-deploys"
						description={
							concurrency.errors.maxConcurrentDeployments ? (
								<span className="text-destructive">{concurrency.errors.maxConcurrentDeployments}</span>
							) : (
								'Extra deployments queue. 1 to 20, default 3.'
							)
						}
					>
						<Input
							id="max-deploys"
							type="number"
							min={1}
							max={20}
							value={concurrency.draft.maxConcurrentDeployments}
							onChange={event => concurrency.set({ maxConcurrentDeployments: event.target.value })}
							aria-invalid={Boolean(concurrency.errors.maxConcurrentDeployments)}
							className="w-24 tabular-nums"
						/>
					</Row>
					<Row
						label="PR previews per project"
						htmlFor="preview-limit"
						description={
							prPreview.errors.maxPreviewsPerProject ? (
								<span className="text-destructive">{prPreview.errors.maxPreviewsPerProject}</span>
							) : (
								'Max simultaneous preview environments per project. 0 pauses creation.'
							)
						}
					>
						<Input
							id="preview-limit"
							type="number"
							min={0}
							max={100}
							value={prPreview.draft.maxPreviewsPerProject}
							onChange={event => prPreview.set({ maxPreviewsPerProject: event.target.value })}
							aria-invalid={Boolean(prPreview.errors.maxPreviewsPerProject)}
							className="w-24 tabular-nums"
						/>
					</Row>
				</div>
			</SettingsCard>

			<StorageCard groups={groups} />
			<AutoscalingCard groups={groups} />
		</>
	);
}

function StorageCard({ groups: { autoscaling, volumes, showRegistryStorage } }: { groups: ScalingGroups }) {
	const threshold = autoscaling.draft.enabled && !autoscaling.errors.thresholdPercent ? Number(autoscaling.draft.thresholdPercent) : undefined;
	const visible = volumes.data?.volumes.filter(volume => showRegistryStorage || volume.volume !== 'registry') ?? [];

	return (
		<SettingsCard
			title="Storage"
			description={
				<>
					Live fill of platform-managed volumes.
					{threshold !== undefined && (
						<span className="ml-2 inline-flex items-center gap-1.5 text-xs">
							<span className="h-2.5 w-0.5 rounded-full bg-foreground" aria-hidden /> autoscale threshold
						</span>
					)}
				</>
			}
		>
			{volumes.isPending ? (
				<p className="flex items-center gap-2 text-sm text-muted-foreground">
					<LoaderCircleIcon className="size-4 animate-spin" />
					Loading usage…
				</p>
			) : volumes.data ? (
				<ul className="space-y-5">
					{visible.map(volume => {
						const meta = VOLUMES[volume.volume];
						const percent = volume.available ? (percentOf(volume.usedBytes, volume.capacityBytes) ?? 0) : 0;
						return (
							<li key={volume.volume} className="space-y-2">
								<div className="flex items-center justify-between gap-3 text-sm">
									<span className="flex items-center gap-1.5 font-medium">
										<meta.icon className="size-4 text-muted-foreground" />
										{meta.title}
									</span>
									{volume.available ? (
										<span className="text-xs text-muted-foreground tabular-nums">
											<span className="text-foreground">{formatBytes(volume.usedBytes)}</span> / {formatBytes(volume.capacityBytes)} ·{' '}
											{Math.round(percent)}%
										</span>
									) : (
										<span className="text-xs text-muted-foreground">No usage data</span>
									)}
								</div>
								<Meter percent={percent} marker={volume.available ? threshold : undefined} />
								<div className="flex justify-between gap-3 text-xs text-muted-foreground">
									<span>{volume.capBytes !== null && `Grows up to ${formatBytes(volume.capBytes)}`}</span>
									{volume.available && volume.sampledAt && <span>Sampled {formatRelative(volume.sampledAt)}</span>}
								</div>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">Volume usage is unavailable right now.</p>
			)}
		</SettingsCard>
	);
}

function AutoscalingCard({ groups: { autoscaling, volumes, showRegistryStorage } }: { groups: ScalingGroups }) {
	const { draft, errors, set } = autoscaling;
	const hasPrometheus = volumes.data?.volumes.some(volume => volume.volume === 'prometheus') ?? false;
	const disabled = !draft.enabled;

	return (
		<SettingsCard
			title="Volume autoscaling"
			description="The worker grows a volume past the threshold by the growth step, up to its cap, at most once per hour. Needs a storage class that supports online expansion."
		>
			<div className="space-y-5">
				<Row label="Enable volume autoscaling" htmlFor="autoscale">
					<Switch id="autoscale" checked={draft.enabled} onCheckedChange={enabled => set({ enabled })} />
				</Row>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Usage threshold" htmlFor="as-threshold" error={errors.thresholdPercent} hint="Usage that triggers growth, 50 to 95.">
						<Suffixed
							id="as-threshold"
							suffix="%"
							disabled={disabled}
							value={draft.thresholdPercent}
							onChange={event => set({ thresholdPercent: event.target.value })}
							aria-invalid={Boolean(errors.thresholdPercent)}
						/>
					</Field>
					<Field label="Growth step" htmlFor="as-growth" error={errors.growthPercent} hint="Added per expansion, 10 to 100.">
						<Suffixed
							id="as-growth"
							suffix="%"
							disabled={disabled}
							value={draft.growthPercent}
							onChange={event => set({ growthPercent: event.target.value })}
							aria-invalid={Boolean(errors.growthPercent)}
						/>
					</Field>
				</div>
				<div
					className={cn(
						'grid gap-4',
						showRegistryStorage && hasPrometheus ? 'sm:grid-cols-3' : showRegistryStorage || hasPrometheus ? 'sm:grid-cols-2' : ''
					)}
				>
					<Field label="Database cap" htmlFor="as-cap-postgres" error={errors.postgresCap}>
						<Input
							id="as-cap-postgres"
							placeholder="100Gi"
							className="font-mono"
							disabled={disabled}
							value={draft.postgresCap}
							onChange={event => set({ postgresCap: event.target.value })}
							aria-invalid={Boolean(errors.postgresCap)}
						/>
					</Field>
					{showRegistryStorage && (
						<Field label="Registry cap" htmlFor="as-cap-registry" error={errors.registryCap}>
							<Input
								id="as-cap-registry"
								placeholder="200Gi"
								className="font-mono"
								disabled={disabled}
								value={draft.registryCap}
								onChange={event => set({ registryCap: event.target.value })}
								aria-invalid={Boolean(errors.registryCap)}
							/>
						</Field>
					)}
					{hasPrometheus && (
						<Field label="Prometheus cap" htmlFor="as-cap-prometheus" error={errors.prometheusCap}>
							<Input
								id="as-cap-prometheus"
								placeholder="50Gi"
								className="font-mono"
								disabled={disabled}
								value={draft.prometheusCap}
								onChange={event => set({ prometheusCap: event.target.value })}
								aria-invalid={Boolean(errors.prometheusCap)}
							/>
						</Field>
					)}
				</div>
				<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
					{draft.enabled ? (
						<>
							When a volume passes <span className="font-medium text-foreground">{draft.thresholdPercent}%</span>, it grows by{' '}
							<span className="font-medium text-foreground">{draft.growthPercent}%</span>, up to its cap.
						</>
					) : (
						'Volumes keep their size until resized manually.'
					)}
				</p>
			</div>
		</SettingsCard>
	);
}
