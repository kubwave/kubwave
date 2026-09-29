import type { UpdateRunDto } from '@kubwave/api-client';
import { CircleCheckIcon, CircleDashedIcon, CircleHelpIcon, CircleXIcon, LoaderCircleIcon, Undo2Icon } from 'lucide-react';

export type UpdateRun = UpdateRunDto;

type StatusMeta = { icon: React.ComponentType<{ className?: string }>; label: string; className: string; spin?: boolean };

const STATUS_META: Record<string, StatusMeta> = {
	pending: { icon: CircleDashedIcon, label: 'Pending', className: 'text-muted-foreground' },
	running: { icon: LoaderCircleIcon, label: 'Running', className: 'text-info', spin: true },
	succeeded: { icon: CircleCheckIcon, label: 'Succeeded', className: 'text-success' },
	failed: { icon: CircleXIcon, label: 'Failed', className: 'text-destructive' },
	rolled_back: { icon: Undo2Icon, label: 'Rolled back', className: 'text-warning' }
};

const FALLBACK_META: StatusMeta = { icon: CircleHelpIcon, label: 'Unknown', className: 'text-muted-foreground' };

const PHASE_LABELS: Record<string, string> = {
	prepare: 'Preparing update',
	'helm-traefik': 'Installing Traefik',
	'helm-cert-manager': 'Installing cert-manager',
	'wait-dependencies': 'Checking dependencies',
	'helm-upgrade': 'Applying platform upgrade',
	helm: 'Applying platform upgrade',
	finalize: 'Finalizing update',
	done: 'Finishing update'
};

const STATUS_LABELS: Record<string, string> = {
	pending: 'Preparing update…',
	succeeded: 'Update completed successfully',
	failed: 'Update failed',
	rolled_back: 'Update failed — rollback performed'
};

const TERMINAL = new Set(['succeeded', 'failed', 'rolled_back']);

export function isTerminalUpdateStatus(status: string | undefined): boolean {
	return status !== undefined && TERMINAL.has(status);
}

export function updateRunPollInterval(status: string | undefined): number | false {
	return isTerminalUpdateStatus(status) ? false : 2000;
}

export function updateRunStatusLabel(run: Pick<UpdateRun, 'status' | 'phase'> | undefined): string {
	if (run?.status === 'running') return (run.phase && PHASE_LABELS[run.phase]) ?? run.phase ?? 'Update in progress…';
	return (run && STATUS_LABELS[run.status]) ?? 'Unknown status';
}

export function updateRunStatusMeta(status: string): StatusMeta {
	return STATUS_META[status] ?? FALLBACK_META;
}

export function updateRunTitle(run: Pick<UpdateRun, 'kind' | 'fromVersion' | 'toVersion'>): string {
	return run.kind === 'tcp_port_pool' ? 'TCP port pool' : `${run.fromVersion} → ${run.toVersion}`;
}
