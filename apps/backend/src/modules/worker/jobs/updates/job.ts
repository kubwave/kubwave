import { runSteps } from '../../../../shared/worker-common/steps.js';
import { createJobsForPendingRuns } from './create.js';
import { reconcileActiveUpdateRuns } from './reconcile.js';
import { reapOrphanUpdateJobs } from './reaper.js';

export const UPDATE_RUN_RECONCILE_INTERVAL_MS = 15 * 1000;

// Worker owns the full self-update Job lifecycle: create Jobs for `pending` runs, reconcile active
// runs, reap orphan Jobs. Lives here (not the API) so the API stays read-only on k8s.
export async function runUpdateRunReconcile(): Promise<void> {
	await runSteps('update-reconciler', [
		{ name: 'create-jobs', run: createJobsForPendingRuns },
		{ name: 'reconcile', run: reconcileActiveUpdateRuns },
		{ name: 'reap-orphans', run: reapOrphanUpdateJobs }
	]);
}
