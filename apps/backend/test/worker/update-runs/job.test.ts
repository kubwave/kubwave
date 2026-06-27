import { describe, expect, mock, test } from 'bun:test';

// runUpdateRunReconcile drives create → reconcile → reap through runSteps. Mock each step
// module to assert dispatch order.

const calls: string[] = [];

mock.module('~/modules/worker/jobs/updates/create', () => ({
	createJobsForPendingRuns: async () => {
		calls.push('create');
	}
}));
mock.module('~/modules/worker/jobs/updates/reconcile', () => ({
	reconcileActiveUpdateRuns: async () => {
		calls.push('reconcile');
	}
}));
mock.module('~/modules/worker/jobs/updates/reaper', () => ({
	reapOrphanUpdateJobs: async () => {
		calls.push('reap');
	}
}));

const { runUpdateRunReconcile, UPDATE_RUN_RECONCILE_INTERVAL_MS } = await import('~/modules/worker/jobs/updates/job');

describe('runUpdateRunReconcile', () => {
	test('dispatches create → reconcile → reap in order', async () => {
		calls.length = 0;
		await runUpdateRunReconcile();
		expect(calls).toEqual(['create', 'reconcile', 'reap']);
	});

	test('reconcile interval is 15s', () => {
		expect(UPDATE_RUN_RECONCILE_INTERVAL_MS).toBe(15 * 1000);
	});
});
