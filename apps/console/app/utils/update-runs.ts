import type { FunctionalComponent } from 'vue';
import { Check, History, Loader2, RotateCcw, X } from 'lucide-vue-next';
import type { BadgeVariants } from '~/components/ui/badge';
import { formatDuration, formatRelative } from '~/utils/format';

export interface UpdateRunStatusMeta {
	icon: FunctionalComponent;
	dot: string;
	variant: BadgeVariants['variant'];
	label: string;
	spin?: boolean;
}

interface UpdateRunLike {
	status?: string | null;
	phase?: string | null;
	createdAt?: string | null;
	startedAt?: string | null;
	finishedAt?: string | null;
}

const STATUS_META: Record<string, UpdateRunStatusMeta> = {
	pending: { icon: History, dot: 'bg-warning/15 text-warning', variant: 'secondary', label: 'Pending' },
	running: { icon: Loader2, dot: 'bg-info/15 text-info', variant: 'default', label: 'Running', spin: true },
	succeeded: { icon: Check, dot: 'bg-success/15 text-success-foreground', variant: 'default', label: 'Succeeded' },
	failed: { icon: X, dot: 'bg-destructive/15 text-destructive', variant: 'destructive', label: 'Failed' },
	rolled_back: { icon: RotateCcw, dot: 'bg-destructive/15 text-destructive', variant: 'destructive', label: 'Rolled back' }
};

const FALLBACK_META: UpdateRunStatusMeta = {
	icon: History,
	dot: 'bg-muted text-muted-foreground',
	variant: 'secondary',
	label: 'Unknown'
};

export function updateRunPhaseLabel(phase: string | null | undefined): string {
	switch (phase) {
		case 'prepare':
			return 'Preparing update';
		case 'helm-traefik':
			return 'Installing Traefik';
		case 'helm-cert-manager':
			return 'Installing cert-manager';
		case 'wait-dependencies':
			return 'Checking dependencies';
		case 'helm-upgrade':
		case 'helm':
			return 'Applying platform upgrade';
		case 'finalize':
			return 'Finalizing update';
		case 'done':
			return 'Finishing update';
		default:
			return phase ?? 'Update in progress…';
	}
}

export function updateRunStatusLabel(run: UpdateRunLike | undefined): string {
	switch (run?.status) {
		case 'pending':
			return 'Preparing update…';
		case 'running':
			return updateRunPhaseLabel(run?.phase);
		case 'succeeded':
			return 'Update completed successfully';
		case 'failed':
			return 'Update failed';
		case 'rolled_back':
			return 'Update failed — rollback performed';
		default:
			return 'Unknown status';
	}
}

export function updateRunStatusMeta(status: string | null | undefined): UpdateRunStatusMeta {
	return status ? (STATUS_META[status] ?? FALLBACK_META) : FALLBACK_META;
}

export function updateRunDateLabel(run: UpdateRunLike): string {
	return run.startedAt ? `${formatRelative(run.startedAt)} · ${formatDuration(run.startedAt, run.finishedAt)}` : formatRelative(run.createdAt, '—');
}
