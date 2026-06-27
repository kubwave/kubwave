import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import type { DatabaseServiceConfig } from '@kubwave/db';
import type { DeployContext, ReconcileResult, TeardownContext } from '~/modules/worker/jobs/deployments/deployers/types';

// The database deployers synthesize a runtime config from the real engine catalog and funnel through
// the shared runtime core. Stub only that core to assert the image ref + synthesized config.
const reconcileCalls: Array<{ imageRef: string; config: DatabaseRuntimeForward }> = [];
let teardownCalled = false;

interface DatabaseRuntimeForward {
	containerPort: number | null;
	env: Array<{ key: string; value: string }>;
	secrets?: Array<{ key: string; value: string }>;
	volumes: Array<{ name: string; mountPath: string; size: string }>;
	domains: unknown[];
}

mock.module('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service', () => ({
	reconcileRuntime: async (_ctx: DeployContext, config: DatabaseRuntimeForward, imageRef: string): Promise<ReconcileResult> => {
		reconcileCalls.push({ imageRef, config });
		return { state: 'ready' };
	},
	teardownRuntime: async (_ctx: TeardownContext) => {
		teardownCalled = true;
	}
}));

const { postgresDeployer, mysqlDeployer, mariadbDeployer, mongodbDeployer } = await import('~/modules/worker/jobs/deployments/deployers/database');

const kc = { makeApiClient: () => ({}) } as unknown as KubeConfig;

function makeCtx(type: string, config: DatabaseServiceConfig): DeployContext {
	return {
		kc,
		namespace: 'kubwave-env-1',
		environmentId: 'env-1',
		deployment: { id: 'dep-1', serviceId: 'svc-1', type, config } as DeployContext['deployment'],
		ingress: { className: undefined, clusterIssuer: undefined, annotations: {} },
		defaultDomainHost: null
	};
}

function dbConfig(overrides: Partial<DatabaseServiceConfig> = {}): DatabaseServiceConfig {
	return {
		version: '16',
		storage: { size: '1Gi' },
		password: 'v1:cipher',
		username: 'app',
		database: 'shop',
		containerPort: 5432,
		env: [],
		domains: [],
		volumes: [],
		...overrides
	};
}

describe('database deployers', () => {
	test('each deployer declares its own engine type', () => {
		expect(postgresDeployer.type).toBe('postgres');
		expect(mysqlDeployer.type).toBe('mysql');
		expect(mariadbDeployer.type).toBe('mariadb');
		expect(mongodbDeployer.type).toBe('mongodb');
	});

	test('postgres reconcile forwards the engine image ref and synthesized config', async () => {
		reconcileCalls.length = 0;
		const result = await postgresDeployer.reconcile(makeCtx('postgres', dbConfig()));
		expect(result).toEqual({ state: 'ready' });
		expect(reconcileCalls).toHaveLength(1);
		expect(reconcileCalls[0]!.imageRef).toBe('postgres:16');
		const cfg = reconcileCalls[0]!.config;
		expect(cfg.containerPort).toBe(5432);
		expect(cfg.secrets).toContainEqual({ key: 'POSTGRES_PASSWORD', value: 'v1:cipher' });
		expect(cfg.volumes).toEqual([{ name: 'data', mountPath: '/var/lib/postgresql/data', size: '1Gi' }]);
		// Internal datastore: no public domains.
		expect(cfg.domains).toEqual([]);
	});

	test('mongodb reconcile uses its image and version', async () => {
		reconcileCalls.length = 0;
		await mongodbDeployer.reconcile(makeCtx('mongodb', dbConfig({ version: '7', containerPort: 27017 })));
		expect(reconcileCalls[0]!.imageRef).toBe('mongo:7');
		expect(reconcileCalls[0]!.config.containerPort).toBe(27017);
	});

	test('teardown delegates to the shared runtime teardown', async () => {
		teardownCalled = false;
		await postgresDeployer.teardown({ kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' } as TeardownContext);
		expect(teardownCalled).toBe(true);
	});
});
