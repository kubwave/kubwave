import { describe, expect, mock, test } from 'bun:test';
import type { V1Job } from '@kubernetes/client-node';

// outcome.ts is a pure decision function; mock db so the import alias never touches a real
// connection.
mock.module('@kubwave/db', () => ({ db: {}, updateRuns: {} }));

const { getUpdateRunReconcileOutcome, UPDATE_RUN_CREATION_GRACE_MS, UPDATE_RUN_TIMEOUT_MS } = await import('~/modules/worker/jobs/updates/outcome');

type Run = Parameters<typeof getUpdateRunReconcileOutcome>[0];

const now = new Date('2026-06-17T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

function run(overrides: Partial<Run> = {}): Run {
	return {
		status: 'running',
		startedAt: minutesAgo(1),
		createdAt: minutesAgo(1),
		jobName: 'update-abc',
		...overrides
	};
}

describe('getUpdateRunReconcileOutcome', () => {
	test('ignores terminal runs (succeeded/failed) — nothing to reconcile', () => {
		expect(getUpdateRunReconcileOutcome(run({ status: 'succeeded' }), null, now)).toBeNull();
		expect(getUpdateRunReconcileOutcome(run({ status: 'failed' }), null, now)).toBeNull();
	});

	test('no job yet but still inside the creation grace window → wait', () => {
		const r = run({ jobName: null, createdAt: minutesAgo(1) });
		expect(getUpdateRunReconcileOutcome(r, null, now)).toBeNull();
	});

	test('no job and past the creation grace → fail with "not created"', () => {
		const r = run({ jobName: null, createdAt: minutesAgo(5) }); // > 2min grace
		expect(getUpdateRunReconcileOutcome(r, null, now)).toEqual({ status: 'failed', lastError: 'Update job was not created.' });
	});

	test('job linked but vanished from cluster → fail with "deleted"', () => {
		expect(getUpdateRunReconcileOutcome(run(), null, now)).toEqual({
			status: 'failed',
			lastError: 'Update job was deleted or is no longer present.'
		});
	});

	test('a succeeded Job promotes the run even if finalize never wrote', () => {
		const job = { status: { succeeded: 1 } } as V1Job;
		expect(getUpdateRunReconcileOutcome(run(), job, now)).toEqual({ status: 'succeeded' });
	});

	test('job.status.failed>0 → failed with generic message when no condition', () => {
		const job = { status: { failed: 1 } } as V1Job;
		expect(getUpdateRunReconcileOutcome(run(), job, now)).toEqual({ status: 'failed', lastError: 'Update job failed.' });
	});

	test('a Failed condition formats reason + message into lastError', () => {
		const job = {
			status: {
				conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded', message: 'Job has reached the specified backoff limit' }]
			}
		} as V1Job;
		expect(getUpdateRunReconcileOutcome(run(), job, now)).toEqual({
			status: 'failed',
			lastError: 'Update job failed: BackoffLimitExceeded: Job has reached the specified backoff limit'
		});
	});

	test('a Failed condition with no details → generic failure', () => {
		const job = { status: { conditions: [{ type: 'Failed', status: 'True' }] } } as V1Job;
		expect(getUpdateRunReconcileOutcome(run(), job, now)).toEqual({ status: 'failed', lastError: 'Update job failed.' });
	});

	test('succeeded takes precedence over a failed condition on the same job', () => {
		const job = { status: { succeeded: 1, conditions: [{ type: 'Failed', status: 'True' }] } } as V1Job;
		expect(getUpdateRunReconcileOutcome(run(), job, now)).toEqual({ status: 'succeeded' });
	});

	test('a non-True / non-Failed condition is ignored (still running, no timeout)', () => {
		const job = { status: { conditions: [{ type: 'Complete', status: 'False' }] } } as V1Job;
		expect(getUpdateRunReconcileOutcome(run({ startedAt: minutesAgo(1) }), job, now)).toBeNull();
	});

	test('running past the 65min timeout (using startedAt) → timed out', () => {
		const job = { status: {} } as V1Job;
		const r = run({ startedAt: minutesAgo(66), createdAt: minutesAgo(70) });
		expect(getUpdateRunReconcileOutcome(r, job, now)).toEqual({ status: 'failed', lastError: 'Update timed out after 65 minutes.' });
	});

	test('timeout falls back to createdAt when startedAt is null', () => {
		const job = { status: {} } as V1Job;
		const r = run({ startedAt: null, createdAt: minutesAgo(66) });
		expect(getUpdateRunReconcileOutcome(r, job, now)).toEqual({ status: 'failed', lastError: 'Update timed out after 65 minutes.' });
	});

	test('still within the timeout window → no outcome', () => {
		const job = { status: {} } as V1Job;
		expect(getUpdateRunReconcileOutcome(run({ startedAt: minutesAgo(10) }), job, now)).toBeNull();
	});

	test('defaults `now` to wall clock when omitted (fresh run is still pending)', () => {
		const r = run({ status: 'pending', jobName: null, createdAt: new Date() });
		expect(getUpdateRunReconcileOutcome(r, null)).toBeNull();
	});

	test('grace/timeout constants are the documented values', () => {
		expect(UPDATE_RUN_CREATION_GRACE_MS).toBe(2 * 60 * 1000);
		expect(UPDATE_RUN_TIMEOUT_MS).toBe(65 * 60 * 1000);
	});
});
