import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import type { Deployment } from '@kubwave/db';

// reconcileCanceling rolls a service back to its previous successful deployment. Two branches:
// (a) NO previous → teardown + finalize canceled; (b) a previous exists → re-reconcile it and
// mirror its outcome (canceled on ready, failed on rollback failure, progress while in-flight).

let previousRow: unknown[] = []; // result of the previousSuccessfulDeployment select
const teardownCalls: Array<{ serviceId: string; namespace: string }> = [];
const finalizeCalls: Array<{
	id: string;
	expected: string;
	fields: { status: string; phase: string; lastError: string | null; rollbackAttempts?: number };
}> = [];
const updateSets: Array<Record<string, unknown>> = [];
let phaseReturning: unknown[] = [{ id: 'matched' }];
const insertLogsCalls: Array<{ id: string }> = [];
const deletedBuildArtifacts: string[] = [];
let hasRunningBuildJob = false;

mock.module('~/shared/config/worker-env', () => ({ env: { ingressControllerNamespace: 'kube-system' } }));
mock.module('@kubwave/db', () => ({
	deployments: {
		id: 'id',
		serviceId: 'serviceId',
		status: 'status',
		createdAt: 'createdAt',
		phase: 'phase',
		rollbackAttempts: 'rollbackAttempts'
	},
	db: {
		select: () => ({
			from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => previousRow }) }) })
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				updateSets.push(values);
				return { where: () => ({ returning: async () => phaseReturning }) };
			}
		})
	}
}));
mock.module('~/shared/cluster/namespaces', () => ({
	ensureEnvironmentNamespace: async ({ environmentId }: { environmentId: string }) => `kubwave-env-${environmentId}`
}));
mock.module('~/modules/worker/jobs/deployments/builds/service', () => ({
	hasRunningBuildJobForDeployment: async () => hasRunningBuildJob,
	deleteBuildArtifactsForDeployment: async (_kc: KubeConfig, deploymentId: string) => {
		deletedBuildArtifacts.push(deploymentId);
	}
}));
mock.module('~/modules/worker/jobs/deployments/ingress-options', () => ({ ingressOptions: { annotations: {} } }));
mock.module('~/modules/worker/jobs/deployments/logs', () => ({
	finalize: async (id: string, expected: string, fields: { status: string; phase: string; lastError: string | null; rollbackAttempts?: number }) => {
		finalizeCalls.push({ id, expected, fields });
	},
	insertLogs: async (id: string) => {
		insertLogsCalls.push({ id });
	},
	logEntry: (level: string, step: string, message: string) => ({ level, step, message }),
	phaseEntry: (phase: string) => ({ phase })
}));

let reconcileOutcome: unknown = { state: 'ready', events: [] };
const reconcileCalls: unknown[] = [];
mock.module('~/modules/worker/jobs/deployments/deployers/registry', () => ({
	getDeployer: () => ({
		teardown: async (ctx: { serviceId: string; namespace: string }) => {
			teardownCalls.push({ serviceId: ctx.serviceId, namespace: ctx.namespace });
		},
		reconcile: async (ctx: unknown) => {
			reconcileCalls.push(ctx);
			return reconcileOutcome;
		}
	})
}));

const { reconcileCanceling } = await import('~/modules/worker/jobs/deployments/cancel');

const kc = { makeApiClient: () => ({}) } as unknown as KubeConfig;
const cancelingRow = {
	id: 'dep-2',
	serviceId: 'svc-1',
	type: 'docker-image',
	status: 'canceling',
	phase: 'applying',
	rollbackAttempts: 0
} as unknown as Deployment;

afterEach(() => {
	previousRow = [];
	teardownCalls.length = 0;
	finalizeCalls.length = 0;
	updateSets.length = 0;
	phaseReturning = [{ id: 'matched' }];
	insertLogsCalls.length = 0;
	deletedBuildArtifacts.length = 0;
	hasRunningBuildJob = false;
	reconcileOutcome = { state: 'ready', events: [] };
	reconcileCalls.length = 0;
});

describe('reconcileCanceling', () => {
	test('build-phase cancel with a running build job deletes only build artifacts and finalizes canceled', async () => {
		hasRunningBuildJob = true;
		await reconcileCanceling(kc, { ...cancelingRow, type: 'dockerfile', phase: 'building' } as never, 'env-1', 'svc.example.com');
		expect(deletedBuildArtifacts).toEqual(['dep-2']);
		expect(teardownCalls).toEqual([]);
		expect(reconcileCalls).toEqual([]);
		expect(finalizeCalls[0]).toMatchObject({
			id: 'dep-2',
			expected: 'canceling',
			fields: { status: 'canceled', phase: 'canceled', lastError: null }
		});
	});

	test('build-phase cancel without a running build job falls through to rollback', async () => {
		previousRow = [{ id: 'dep-1', serviceId: 'svc-1', type: 'dockerfile', status: 'succeeded' }];
		reconcileOutcome = { state: 'ready', events: [] };
		await reconcileCanceling(kc, { ...cancelingRow, type: 'dockerfile', phase: 'building' } as never, 'env-1', 'svc.example.com');
		expect(deletedBuildArtifacts).toEqual([]);
		expect(reconcileCalls).toHaveLength(1);
		expect(reconcileCalls[0]).toMatchObject({ buildMode: 'rollback' });
		expect(finalizeCalls[0]).toMatchObject({ fields: { status: 'canceled', phase: 'canceled', lastError: null } });
	});

	test('with no previous deployment: tears the service down and finalizes canceled', async () => {
		previousRow = []; // nothing to roll back to
		await reconcileCanceling(kc, cancelingRow, 'env-1', 'svc.example.com');
		expect(teardownCalls).toEqual([{ serviceId: 'svc-1', namespace: 'kubwave-env-env-1' }]);
		expect(reconcileCalls).toEqual([]); // no rollback reconcile
		expect(finalizeCalls).toHaveLength(1);
		expect(finalizeCalls[0]).toMatchObject({
			id: 'dep-2',
			expected: 'canceling',
			fields: { status: 'canceled', phase: 'canceled', lastError: null }
		});
	});

	test('with a previous deployment that re-reconciles ready: finalizes canceled (restored)', async () => {
		previousRow = [{ id: 'dep-1', serviceId: 'svc-1', type: 'docker-image', status: 'succeeded' }];
		reconcileOutcome = { state: 'ready', events: [] };
		await reconcileCanceling(kc, cancelingRow, 'env-1', 'svc.example.com');
		expect(teardownCalls).toEqual([]); // rolled forward, not torn down
		expect(reconcileCalls).toHaveLength(1);
		expect(reconcileCalls[0]).toMatchObject({ buildMode: 'rollback' });
		expect(finalizeCalls[0]).toMatchObject({ expected: 'canceling', fields: { status: 'canceled', phase: 'canceled', lastError: null } });
	});

	test('with a previous whose rollback fails: records a retry before the hard limit', async () => {
		previousRow = [{ id: 'dep-1', serviceId: 'svc-1', type: 'docker-image', status: 'succeeded' }];
		reconcileOutcome = { state: 'failed', error: 'bad image' };
		await reconcileCanceling(kc, cancelingRow, 'env-1', 'svc.example.com');
		expect(finalizeCalls).toEqual([]);
		expect(updateSets[0]).toMatchObject({
			rollbackAttempts: 1,
			phase: 'rollback-retrying',
			lastError: 'Cancel rollback failed: bad image'
		});
		expect(insertLogsCalls).toHaveLength(1);
	});

	test('with a previous whose rollback fails for the third time: finalizes failed', async () => {
		previousRow = [{ id: 'dep-1', serviceId: 'svc-1', type: 'docker-image', status: 'succeeded' }];
		reconcileOutcome = { state: 'failed', error: 'bad image' };
		await reconcileCanceling(kc, { ...cancelingRow, rollbackAttempts: 2 } as never, 'env-1', 'svc.example.com');
		expect(finalizeCalls[0]).toMatchObject({
			fields: { status: 'failed', phase: 'failed', lastError: 'Cancel rollback failed: bad image', rollbackAttempts: 3 }
		});
	});

	test('with a previous still progressing: updates the canceling phase + logs it (phase changed)', async () => {
		previousRow = [{ id: 'dep-1', serviceId: 'svc-1', type: 'docker-image', status: 'succeeded' }];
		reconcileOutcome = { state: 'progressing', phase: 'rolling-out', events: [] };
		phaseReturning = [{ id: 'dep-2' }]; // phase update matched
		await reconcileCanceling(kc, cancelingRow, 'env-1', 'svc.example.com');
		expect(finalizeCalls).toEqual([]); // not terminal yet
		expect(updateSets.some(s => s.phase === 'rolling-out')).toBe(true);
		expect(insertLogsCalls).toHaveLength(1);
	});

	test('progressing whose phase update matched no row skips the log write', async () => {
		previousRow = [{ id: 'dep-1', serviceId: 'svc-1', type: 'docker-image', status: 'succeeded' }];
		reconcileOutcome = { state: 'progressing', phase: 'rolling-out', events: [] };
		phaseReturning = []; // row moved on between select and update
		await reconcileCanceling(kc, cancelingRow, 'env-1', 'svc.example.com');
		expect(insertLogsCalls).toEqual([]);
	});
});
