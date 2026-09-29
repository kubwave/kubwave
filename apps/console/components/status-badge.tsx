import { cn } from '@/lib/utils';
import type { DeploymentViewDto, ServiceRuntimeDto } from '@kubwave/api-client';

export type RuntimeStatus = ServiceRuntimeDto['status'];
export type DeploymentStatus = DeploymentViewDto['status'];

export const runtimeStyles: Record<RuntimeStatus, { label: string; dot: string; text: string }> = {
	running: { label: 'Running', dot: 'bg-success', text: 'text-success' },
	degraded: { label: 'Degraded', dot: 'bg-warning', text: 'text-warning' },
	progressing: { label: 'Deploying', dot: 'bg-info animate-pulse', text: 'text-info' },
	failed: { label: 'Failed', dot: 'bg-destructive', text: 'text-destructive' },
	stopped: { label: 'Stopped', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
	not_deployed: { label: 'Not deployed', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
	unknown: { label: 'Unknown', dot: 'bg-muted-foreground', text: 'text-muted-foreground' }
};

export const deploymentStyles: Record<DeploymentStatus, { label: string; dot: string; text: string }> = {
	pending: { label: 'Queued', dot: 'bg-muted-foreground animate-pulse', text: 'text-muted-foreground' },
	deploying: { label: 'Deploying', dot: 'bg-info animate-pulse', text: 'text-info' },
	canceling: { label: 'Canceling', dot: 'bg-warning animate-pulse', text: 'text-warning' },
	succeeded: { label: 'Active', dot: 'bg-success', text: 'text-success' },
	failed: { label: 'Failed', dot: 'bg-destructive', text: 'text-destructive' },
	superseded: { label: 'Removed', dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
	canceled: { label: 'Canceled', dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' }
};

export function StatusDot({ className }: { className?: string }) {
	return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} />;
}

export function RuntimeBadge({ status, replicas, className }: { status: RuntimeStatus; replicas?: [number, number]; className?: string }) {
	const s = runtimeStyles[status];
	return (
		<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.text, className)}>
			<StatusDot className={s.dot} />
			{s.label}
			{replicas && <span className="font-mono text-muted-foreground">{`${replicas[0]}/${replicas[1]}`}</span>}
		</span>
	);
}

export function DeploymentBadge({ status, className }: { status: DeploymentStatus; className?: string }) {
	const s = deploymentStyles[status];
	return (
		<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.text, className)}>
			<StatusDot className={cn('size-1.5', s.dot)} />
			{s.label}
		</span>
	);
}
