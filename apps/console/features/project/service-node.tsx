'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GlobeIcon, HardDriveIcon } from 'lucide-react';
import { RuntimeBadge } from '@/components/status-badge';
import { ServiceIcon } from '@/features/service/service-icon';
import type { Service, ServiceRuntime } from '@/lib/api/types';
import { formatBytes } from '@/lib/format';
import { SERVICE_TYPE_LABEL, serviceDomain, serviceSource, serviceVolume } from '@/lib/service-types';
import { SEVERITY_BAR, usageSeverity } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { volumeUsage } from './canvas-model';
import { useVolumeUsage } from './use-environment';

export type ServiceNodeData = { service: Service; runtime: ServiceRuntime | undefined; dimmed: boolean };
export type ServiceNodeType = Node<ServiceNodeData, 'service'>;

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeType>) {
	const { service, runtime } = data;
	const status = runtime?.status ?? 'unknown';
	const source = serviceSource(service);
	const domain = serviceDomain(service);
	const port = service.config.containerPort;
	const volume = serviceVolume(service);
	const stats = useVolumeUsage(service.id, volume?.name, status === 'running');
	const usage = volume ? volumeUsage(volume.size, stats) : null;

	return (
		<div className={cn('w-64 transition-opacity', data.dimmed && 'opacity-45')}>
			{/* Handles live inside the card so edges meet its middle, not the middle of card plus volume strip. */}
			<div
				className={cn(
					'relative z-10 rounded-lg border bg-card transition-colors hover:border-foreground/25',
					selected && 'border-foreground/60 hover:border-foreground/60',
					status === 'failed' && !selected && 'border-destructive/50',
					status === 'progressing' && !selected && 'border-info/50'
				)}
			>
				<Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-transparent" isConnectable={false} />
				<Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-transparent" isConnectable={false} />
				<div className="space-y-2.5 p-3.5">
					<div className="flex items-start gap-2.5">
						<ServiceIcon type={service.type} className="mt-0.5 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold">{service.name}</div>
							<div className="truncate font-mono text-[11px] text-muted-foreground">
								{source.label}
								{source.branch && <span className="text-muted-foreground/70"> · {source.branch}</span>}
							</div>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<RuntimeBadge status={status} replicas={runtime ? [runtime.readyReplicas, runtime.desiredReplicas] : undefined} />
						<span className="text-[11px] text-muted-foreground">{SERVICE_TYPE_LABEL[service.type]}</span>
					</div>
				</div>
				{(domain || port) && (
					<div className="flex items-center gap-1.5 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
						{domain ? (
							<>
								<GlobeIcon className="size-3 shrink-0" />
								<span className="truncate font-mono">{domain}</span>
							</>
						) : (
							<span className="font-mono">internal</span>
						)}
						{port && <span className="ml-auto shrink-0 font-mono">:{port}</span>}
					</div>
				)}
			</div>
			{volume && (
				<div className="mx-3 -mt-1 rounded-b-lg border border-t-0 bg-muted/60 px-3 pt-2.5 pb-2 text-[11px] text-muted-foreground">
					<div className="flex items-center gap-1.5">
						<HardDriveIcon className="size-3 shrink-0" />
						<span className="truncate font-mono" title={volume.mountPath}>
							{volume.mountPath}
						</span>
						<span
							className="ml-auto shrink-0 font-mono"
							title={
								usage?.nodeDisk
									? `${volume.size} volume on unmetered local storage: showing the node disk (${formatBytes(usage.usedBytes)} / ${formatBytes(usage.capacityBytes)})`
									: undefined
							}
						>
							{!usage
								? volume.size
								: usage.nodeDisk
									? `${volume.size} · disk ${Math.round(usage.pct)}%`
									: `${formatBytes(usage.usedBytes)} / ${formatBytes(usage.capacityBytes)}`}
						</span>
					</div>
					{usage && (
						<div
							className="mt-1.5 h-1 overflow-hidden rounded-full bg-border"
							role="meter"
							aria-label={usage.nodeDisk ? `Node disk usage for ${volume.mountPath}` : `${volume.mountPath} usage`}
							aria-valuenow={Math.round(usage.pct)}
							aria-valuemin={0}
							aria-valuemax={100}
						>
							<div
								className={cn('h-full rounded-full', usage.nodeDisk ? 'bg-muted-foreground/60' : SEVERITY_BAR[usageSeverity(usage.pct)])}
								style={{ width: `${usage.pct}%` }}
							/>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
