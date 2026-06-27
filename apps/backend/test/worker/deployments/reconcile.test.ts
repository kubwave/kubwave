import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';

// reconcileInFlight: select in-flight rows → per row re-assert the lease, then reconcileCanceling or run the deployer and write the outcome.

let selectResults: unknown[][] = [];
let selectIdx = 0;
const updateSets: Array<Record<string, unknown>> = [];
// What each update's .returning() resolves with, popped in order. Default: matched 1 row.
let returningResults: unknown[][] = [];
let returningIdx = 0;

function makeUpdate() {
	return {
		set: (values: Record<string, unknown>) => {
			updateSets.push(values);
			const where = () => {
				const thenable = Promise.resolve(undefined) as Promise<unknown> & { returning: () => Promise<unknown[]> };
				thenable.returning = async () => returningResults[returningIdx++] ?? [{ id: 'matched' }];
				return thenable;
			};
			return { where };
		}
	};
}

mock.module('~/shared/config/worker-env', () => ({
	env: { workerId: 'worker-test', leaseTimeoutMs: 60_000, ingressControllerNamespace: 'kube-system' }
}));
mock.module('@kubwave/db', () => ({
	deployments: { id: 'id', status: 'status', serviceId: 'serviceId', lockedBy: 'lockedBy', lockedAt: 'lockedAt', phase: 'phase' },
	services: { id: 'id', environmentId: 'environmentId', name: 'name' },
	db: {
		select: () => ({ from: () => ({ where: async () => selectResults[selectIdx++] ?? [] }) }),
		update: () => makeUpdate()
	},
	buildDefaultDomainForService: () => 'svc.example.com'
}));

const finalizeCalls: Array<{ id: string; expected: string; fields: unknown; entries: unknown[] }> = [];
const insertLogsCalls: Array<{ id: string; entries: unknown[] }> = [];
mock.module('~/modules/worker/jobs/deployments/logs', () => ({
	finalize: async (id: string, expected: string, fields: unknown, entries: unknown[]) => {
		finalizeCalls.push({ id, expected, fields, entries });
	},
	insertLogs: async (id: string, entries: unknown[]) => {
		insertLogsCalls.push({ id, entries });
	},
	logEntry: (level: string, step: string, message: string) => ({ level, step, message }),
	phaseEntry: (phase: string) => ({ phase })
}));

const cancelCalls: Array<{ id: string; environmentId: string; host: string | null }> = [];
mock.module('~/modules/worker/jobs/deployments/cancel', () => ({
	reconcileCanceling: async (_kc: unknown, row: { id: string }, environmentId: string, host: string | null) => {
		cancelCalls.push({ id: row.id, environmentId, host });
	}
}));

mock.module('~/shared/cluster/namespaces', () => ({
	ensureEnvironmentNamespace: async ({ environmentId }: { environmentId: string }) => `kubwave-env-${environmentId}`
}));
mock.module('~/modules/worker/jobs/deployments/ingress-options', () => ({ ingressOptions: { annotations: {} } }));

// The deployer the registry returns; each test sets its reconcile outcome.
let reconcileOutcome: unknown = { state: 'progressing', phase: 'rolling-out', events: [] };
const deployerReconcileCalls: unknown[] = [];
mock.module('~/modules/worker/jobs/deployments/deployers/registry', () => ({
	getDeployer: () => ({
		reconcile: async (ctx: unknown) => {
			deployerReconcileCalls.push(ctx);
			if (typeof reconcileOutcome === 'function') return (reconcileOutcome as () => unknown)();
			return reconcileOutcome;
		}
	})
}));

const { reconcileInFlight } = await import('~/modules/worker/jobs/deployments/reconcile');

const kc = { makeApiClient: () => ({}) } as unknown as KubeConfig;
const defaultDomain = { mode: 'off', base: null, subdomainTemplate: null } as never;
const runtime = {} as never;

function row(overrides: Record<string, unknown> = {}) {
	return { id: 'dep-1', serviceId: 'svc-1', type: 'docker-image', status: 'deploying', phase: 'applying', lastError: null, ...overrides };
}

afterEach(() => {
	selectResults = [];
	selectIdx = 0;
	updateSets.length = 0;
	returningResults = [];
	returningIdx = 0;
	finalizeCalls.length = 0;
	insertLogsCalls.length = 0;
	cancelCalls.length = 0;
	deployerReconcileCalls.length = 0;
	reconcileOutcome = { state: 'progressing', phase: 'rolling-out', events: [] };
});

describe('reconcileInFlight', () => {
	test('skips a row whose service has no meta (cascaded away mid-tick)', async () => {
		selectResults = [[row()], []]; // in-flight rows, then NO matching service
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(deployerReconcileCalls).toEqual([]);
		expect(finalizeCalls).toEqual([]);
		expect(cancelCalls).toEqual([]);
	});

	test('does nothing when there are no in-flight rows', async () => {
		selectResults = [[]]; // no rows; resolveServiceMeta short-circuits (no service query)
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(selectIdx).toBe(1); // never queried services
		expect(deployerReconcileCalls).toEqual([]);
	});

	test('delegates a canceling row to reconcileCanceling (no deployer run)', async () => {
		selectResults = [[row({ status: 'canceling' })], [{ id: 'svc-1', environmentId: 'env-1', name: 'web' }]];
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(cancelCalls).toEqual([{ id: 'dep-1', environmentId: 'env-1', host: 'svc.example.com' }]);
		expect(deployerReconcileCalls).toEqual([]);
		// The lease re-assert update still fired before dispatch.
		expect(updateSets[0]).toMatchObject({ lockedBy: 'worker-test' });
	});

	test('finalizes succeeded when the deployer reports ready', async () => {
		selectResults = [[row()], [{ id: 'svc-1', environmentId: 'env-1', name: 'web' }]];
		reconcileOutcome = { state: 'ready', events: [{ step: 'created' }] };
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(finalizeCalls).toHaveLength(1);
		expect(finalizeCalls[0]).toMatchObject({ id: 'dep-1', expected: 'deploying', fields: { status: 'succeeded', phase: 'done', lastError: null } });
	});

	test('finalizes failed (with the deployer error) when the deployer reports failed', async () => {
		selectResults = [[row()], [{ id: 'svc-1', environmentId: 'env-1', name: 'web' }]];
		reconcileOutcome = { state: 'failed', error: 'image pull error' };
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(finalizeCalls[0]).toMatchObject({ expected: 'deploying', fields: { status: 'failed', phase: 'failed', lastError: 'image pull error' } });
	});

	test('progressing with a CHANGED phase updates phase + writes the phase log', async () => {
		selectResults = [[row({ phase: 'applying' })], [{ id: 'svc-1', environmentId: 'env-1', name: 'web' }]];
		reconcileOutcome = { state: 'progressing', phase: 'rolling-out', events: [] };
		// Only the phase update calls .returning() (the lease re-assert awaits .where() directly).
		returningResults = [[{ id: 'dep-1' }]]; // phase update matched
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(finalizeCalls).toEqual([]);
		expect(updateSets.some(s => s.phase === 'rolling-out')).toBe(true);
		expect(insertLogsCalls).toHaveLength(1);
		expect(insertLogsCalls[0]?.entries).toContainEqual({ phase: 'rolling-out' });
	});

	test('progressing whose phase update matched NO row skips the log write', async () => {
		selectResults = [[row({ phase: 'applying' })], [{ id: 'svc-1', environmentId: 'env-1', name: 'web' }]];
		reconcileOutcome = { state: 'progressing', phase: 'rolling-out', events: [] };
		returningResults = [[]]; // phase update matched nothing (row moved on)
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(insertLogsCalls).toEqual([]);
	});

	test('a thrown deployer error writes lastError once and logs it (message changed)', async () => {
		selectResults = [[row({ lastError: null })], [{ id: 'svc-1', environmentId: 'env-1', name: 'web' }]];
		reconcileOutcome = () => {
			throw new Error('transient API blip');
		};
		returningResults = [[{ id: 'dep-1' }]]; // only the lastError update calls .returning()
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(updateSets.some(s => s.lastError === 'transient API blip')).toBe(true);
		expect(insertLogsCalls).toHaveLength(1);
		expect(insertLogsCalls[0]?.entries).toContainEqual({ level: 'error', step: 'error', message: 'transient API blip' });
	});

	test('a thrown deployer error with the SAME message does not re-log it', async () => {
		selectResults = [[row({ lastError: 'transient API blip' })], [{ id: 'svc-1', environmentId: 'env-1', name: 'web' }]];
		reconcileOutcome = () => {
			throw new Error('transient API blip');
		};
		returningResults = [[], [{ id: 'dep-1' }]];
		await reconcileInFlight(kc, defaultDomain, runtime);
		expect(insertLogsCalls).toEqual([]); // unchanged message → no spam
	});
});
