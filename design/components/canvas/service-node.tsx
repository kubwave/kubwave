'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { GlobeIcon, HardDriveIcon } from 'lucide-react';
import { ServiceIcon } from '@/components/service/service-icon';
import { RuntimeBadge } from '@/components/status-badge';
import { serviceTypeLabel, type Service } from '@/lib/mock';
import { cn } from '@/lib/utils';

export type ServiceNodeType = Node<{ service: Service; dimmed: boolean }, 'service'>;

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeType>) {
	const s = data.service;
	return (
		<div className={cn('w-64 transition-opacity', data.dimmed && 'opacity-45')}>
			<Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-transparent" isConnectable={false} />
			<div
				className={cn(
					'relative z-10 rounded-lg border bg-card transition-colors hover:border-foreground/25',
					selected && 'border-foreground/60 hover:border-foreground/60',
					s.status === 'failed' && !selected && 'border-destructive/50',
					s.status === 'progressing' && !selected && 'border-info/50'
				)}
			>
				<div className="space-y-2.5 p-3.5">
					<div className="flex items-start gap-2.5">
						<ServiceIcon type={s.type} className="mt-0.5 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold">{s.name}</div>
							<div className="truncate font-mono text-[11px] text-muted-foreground">
								{s.source}
								{s.branch && <span className="text-muted-foreground/70"> · {s.branch}</span>}
							</div>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<RuntimeBadge status={s.status} replicas={s.replicas} />
						<span className="text-[11px] text-muted-foreground">{serviceTypeLabel[s.type]}</span>
					</div>
				</div>
				{(s.domain || s.port) && (
					<div className="flex items-center gap-1.5 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
						{s.domain ? (
							<>
								<GlobeIcon className="size-3 shrink-0" />
								<span className="truncate font-mono">{s.domain}</span>
							</>
						) : (
							<span className="font-mono">internal</span>
						)}
						{s.port && <span className="ml-auto shrink-0 font-mono">:{s.port}</span>}
					</div>
				)}
			</div>
			{s.volume && (
				<div className="mx-3 -mt-1 rounded-b-lg border border-t-0 bg-muted/60 px-3 pt-2.5 pb-2 text-[11px] text-muted-foreground">
					<div className="flex items-center gap-1.5">
						<HardDriveIcon className="size-3" />
						<span className="truncate font-mono">{s.volume.name}</span>
						<span className="ml-auto font-mono">{s.volume.size}</span>
					</div>
					<div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
						<div
							className={cn('h-full rounded-full', s.volume.usedPct > 90 ? 'bg-destructive' : s.volume.usedPct > 70 ? 'bg-warning' : 'bg-primary')}
							style={{ width: `${s.volume.usedPct}%` }}
						/>
					</div>
				</div>
			)}
			<Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-transparent" isConnectable={false} />
		</div>
	);
}
