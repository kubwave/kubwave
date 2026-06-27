import { afterEach, describe, expect, mock, test } from 'bun:test';
import { BatchV1Api, CoreV1Api, type KubeConfig, type V1Job, type V1Pod } from '@kubernetes/client-node';

// reconcileActiveUpdateRuns walks each active run, reads its Job + Pod, and writes the verdict; a throw in one run must not abort the loop. Only IO is mocked.

let activeRuns: unknown[] = [];
const updates: Array<{ set: Record<string, unknown> }> = [];

// Per-jobName fixtures.
let jobs: Record<string, V1Job | { __throw: unknown }> = {};
let pods: Record<string, V1Pod[]> = {};

mock.module('~/shared/config/worker-env', () => ({ env: { podNamespace: 'kubwave' } }));

const batchApi = {
	readNamespacedJob: async ({ name }: { name: string }) => {
		const j = jobs[name];
		if (j && (j as { __throw?: unknown }).__throw) throw (j as { __throw: unknown }).__throw;
		if (!j) throw { code: 404 };
		return j as V1Job;
	}
};
const coreApi = {
	listNamespacedPod: async ({ labelSelector }: { labelSelector: string }) => {
		const jobName = labelSelector.replace('job-name=', '');
		return { items: pods[jobName] ?? [] };
	}
};
const fakeKc = {
	makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batchApi : klass === CoreV1Api ? coreApi : {})
} as unknown as KubeConfig;

mock.module('@kubwave/kube', () => ({
	getKubeConfig: () => fakeKc,
	isNotFound: (err: unknown) => Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 404)
}));

mock.module('@kubwave/db', () => ({
	updateRuns: { status: {} },
	db: {
		select: () => ({ from: () => ({ where: async () => activeRuns }) }),
		update: () => ({
			set: (set: Record<string, unknown>) => {
				updates.push({ set });
				return { where: async () => undefined };
			}
		})
	}
}));

const { reconcileActiveUpdateRuns } = await import('~/modules/worker/jobs/updates/reconcile');

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

function run(overrides: Record<string, unknown> = {}) {
	return {
		id: 'run-1',
		status: 'running',
		jobName: 'update-run-1',
		phase: 'helm',
		startedAt: minutesAgo(1),
		createdAt: minutesAgo(1),
		...overrides
	} as never;
}

const succeededJob = { status: { succeeded: 1 } } as V1Job;
const failedJob = { status: { failed: 1 } } as V1Job;

function podWithPhase(current: string): V1Pod {
	// initContainers prepare(done)+helm; main finalize. `current` is the running init.
	return {
		spec: { initContainers: [{ name: 'prepare' }, { name: 'helm' }], containers: [{ name: 'finalize' }] },
		status: {
			initContainerStatuses: [
				{ name: 'prepare', state: { terminated: { exitCode: 0 } } },
				{ name: 'helm', state: current === 'helm' ? { running: {} } : { terminated: { exitCode: 0 } } }
			]
		}
	} as unknown as V1Pod;
}

function podWithFailure(container: string): V1Pod {
	return {
		spec: { initContainers: [{ name: 'prepare' }, { name: 'helm' }], containers: [{ name: 'finalize' }] },
		status: {
			initContainerStatuses: [
				{ name: 'prepare', state: { terminated: { exitCode: 0 } } },
				{ name: container, state: { terminated: { exitCode: 1, reason: 'Error', message: 'helm boom' } } }
			]
		}
	} as unknown as V1Pod;
}

afterEach(() => {
	activeRuns = [];
	updates.length = 0;
	jobs = {};
	pods = {};
});

describe('reconcileActiveUpdateRuns', () => {
	test('succeeded Job promotes the run to succeeded/done', async () => {
		activeRuns = [run()];
		jobs = { 'update-run-1': succeededJob };
		await reconcileActiveUpdateRuns();
		expect(updates).toHaveLength(1);
		expect(updates[0]!.set).toMatchObject({ status: 'succeeded', phase: 'done', lastError: null });
		expect(updates[0]!.set.finishedAt).toBeInstanceOf(Date);
	});

	test('failed Job with a failing container writes the container-derived message + phase', async () => {
		activeRuns = [run()];
		jobs = { 'update-run-1': failedJob };
		pods = { 'update-run-1': [podWithFailure('helm')] };
		await reconcileActiveUpdateRuns();
		expect(updates[0]!.set).toMatchObject({
			status: 'failed',
			phase: 'helm',
			lastError: 'Update container "helm" failed: Error (exit 1): helm boom'
		});
	});

	test('failed Job with no pod falls back to the outcome message + keeps run phase', async () => {
		activeRuns = [run({ phase: 'helm' })];
		jobs = { 'update-run-1': failedJob };
		pods = {}; // no pod
		await reconcileActiveUpdateRuns();
		expect(updates[0]!.set).toMatchObject({ status: 'failed', lastError: 'Update job failed.', phase: 'helm' });
	});

	test('no verdict but the pod advanced → only the phase is written', async () => {
		activeRuns = [run({ phase: 'prepare' })];
		jobs = { 'update-run-1': { status: {} } as V1Job };
		pods = { 'update-run-1': [podWithPhase('helm')] };
		await reconcileActiveUpdateRuns();
		expect(updates).toHaveLength(1);
		expect(updates[0]!.set).toEqual({ phase: 'helm' });
	});

	test('no verdict and phase unchanged → no write', async () => {
		activeRuns = [run({ phase: 'helm' })];
		jobs = { 'update-run-1': { status: {} } as V1Job };
		pods = { 'update-run-1': [podWithPhase('helm')] };
		await reconcileActiveUpdateRuns();
		expect(updates).toEqual([]);
	});

	test('linked Job that 404s → run failed (job deleted)', async () => {
		activeRuns = [run()];
		jobs = {}; // readNamespacedJob throws 404
		await reconcileActiveUpdateRuns();
		expect(updates[0]!.set).toMatchObject({ status: 'failed', lastError: 'Update job was deleted or is no longer present.' });
	});

	test('run with no jobName yet (inside grace) → no read, no write', async () => {
		activeRuns = [run({ jobName: null, createdAt: minutesAgo(1) })];
		await reconcileActiveUpdateRuns();
		expect(updates).toEqual([]);
	});

	test('a non-404 Job read error is caught per-run and does not abort the loop', async () => {
		activeRuns = [run({ id: 'boom', jobName: 'update-boom' }), run({ id: 'ok', jobName: 'update-ok' })];
		jobs = { 'update-boom': { __throw: { code: 500, message: 'apiserver down' } }, 'update-ok': succeededJob };
		await reconcileActiveUpdateRuns();
		// the second run still reconciled to succeeded despite the first throwing
		expect(updates).toHaveLength(1);
		expect(updates[0]!.set).toMatchObject({ status: 'succeeded' });
	});

	test('no active runs → no work', async () => {
		activeRuns = [];
		await reconcileActiveUpdateRuns();
		expect(updates).toEqual([]);
	});
});
