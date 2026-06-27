import type * as k8s from '@kubernetes/client-node';

export const UPDATE_RUN_CREATION_GRACE_MS = 2 * 60 * 1000;
export const UPDATE_RUN_TIMEOUT_MS = 65 * 60 * 1000;

export interface ReconcileableRun {
	status: string;
	startedAt: Date | null;
	createdAt: Date;
	jobName: string | null;
}

export interface ReconcileSuccess {
	status: 'succeeded';
}

export interface ReconcileFailure {
	status: 'failed';
	lastError: string;
}

export type ReconcileOutcome = ReconcileSuccess | ReconcileFailure;

export function getUpdateRunReconcileOutcome(run: ReconcileableRun, job: k8s.V1Job | null, now = new Date()): ReconcileOutcome | null {
	if (run.status !== 'pending' && run.status !== 'running') {
		return null;
	}

	if (!run.jobName) {
		if (now.getTime() - run.createdAt.getTime() > UPDATE_RUN_CREATION_GRACE_MS) {
			return { status: 'failed', lastError: 'Update job was not created.' };
		}
		return null;
	}

	if (!job) {
		return { status: 'failed', lastError: 'Update job was deleted or is no longer present.' };
	}

	// Safety net for a lost terminal write: the finalize container normally flips the run to
	// 'succeeded', but if that write never lands a succeeded Job means we promote the run here.
	if ((job.status?.succeeded ?? 0) > 0) {
		return { status: 'succeeded' };
	}

	const failedCondition = job.status?.conditions?.find(condition => condition.type === 'Failed' && condition.status === 'True');
	if ((job.status?.failed ?? 0) > 0 || failedCondition) {
		return {
			status: 'failed',
			lastError: formatJobFailure(failedCondition)
		};
	}

	const referenceDate = run.startedAt ?? run.createdAt;
	if (now.getTime() - referenceDate.getTime() > UPDATE_RUN_TIMEOUT_MS) {
		return { status: 'failed', lastError: 'Update timed out after 65 minutes.' };
	}

	return null;
}

function formatJobFailure(condition: k8s.V1JobCondition | undefined): string {
	if (!condition) {
		return 'Update job failed.';
	}

	const details = [condition.reason, condition.message].filter(Boolean).join(': ');
	return details ? `Update job failed: ${details}` : 'Update job failed.';
}
