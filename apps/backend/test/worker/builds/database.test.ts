import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import type { DatabaseServiceConfig } from '@kubwave/db';
import type { DeployContext, ReconcileResult, TeardownContext } from '~/modules/worker/jobs/deployments/deployers/types';

// The database deployers synthesize a runtime config from the real engine catalog and funnel through
// the shared runtime core. Stub only that core to assert the image ref + synthesized config.
const reconcileCalls: Array<{ imageRef: string; config: DatabaseRuntimeForward; opts: { mutableTag?: boolean } | undefined }> = [];
let teardownCalled = false;

interface DatabaseRuntimeForward {
	containerPort: number | null;
	env: Array<{ key: string; value: string }>;
	secrets?: Array<{ key: string; value: string }>;
	volumes: Array<{ name: string; mountPath: string; size: string }>;
	domains: unknown[];
}

const DIGEST = 'sha256:1f0e3dad99908345f7439f8ffabdffc418afc3c1a9e0f3bcd2f2e1a9c0b7d6e5';
const resolveCalls: Array<{ deploymentId: string; recordedRef?: string | null; image: string; tag: string; label: string }> = [];
let resolvePinned = true;

mock.module('~/modules/worker/jobs/deployments/image-ref', () => ({
	resolveDeploymentImageRef: async (args: { deploymentId: string; recordedRef?: string | null; image: string; tag: string; label: string }) => {
		resolveCalls.push(args);
		if (args.recordedRef) return { ref: args.recordedRef, pinned: args.recordedRef.includes('@') };
		return resolvePinned ? { ref: `${args.image}@${DIGEST}`, pinned: true } : { ref: `${args.image}:${args.tag}`, pinned: false };
	}
}));

mock.module('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service', () => ({
	reconcileRuntime: async (
		_ctx: DeployContext,
		config: DatabaseRuntimeForward,
		imageRef: string,
		opts?: { mutableTag?: boolean }
	): Promise<ReconcileResult> => {
		reconcileCalls.push({ imageRef, config, opts });
		return { state: 'ready' };
	},
	teardownRuntime: async (_ctx: TeardownContext) => {
		teardownCalled = true;
	}
}));

const { postgresDeployer, mysqlDeployer, mariadbDeployer, mongodbDeployer } = await import('~/modules/worker/jobs/deployments/deployers/database');

const kc = { makeApiClient: () => ({}) } as unknown as KubeConfig;

function makeCtx(type: string, config: DatabaseServiceConfig, imageRef?: string): DeployContext {
	return {
		kc,
		namespace: 'kubwave-env-1',
		environmentId: 'env-1',
		deployment: { id: 'dep-1', serviceId: 'svc-1', type, config, imageRef: imageRef ?? null } as DeployContext['deployment'],
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
	// The catalog selects a major line (postgres:16, mongo:8), which upstream republishes on every patch release.
	test('resolves the engine tag through the shared resolver and deploys the pinned ref', async () => {
		for (const [deployer, type, version, image] of [
			[postgresDeployer, 'postgres', '16', 'postgres'],
			[mysqlDeployer, 'mysql', '8.4', 'mysql'],
			[mariadbDeployer, 'mariadb', '11.4', 'mariadb'],
			[mongodbDeployer, 'mongodb', '8', 'mongo']
		] as const) {
			reconcileCalls.length = 0;
			resolveCalls.length = 0;
			await deployer.reconcile(makeCtx(type, dbConfig({ version })));
			expect(resolveCalls[0]).toMatchObject({ deploymentId: 'dep-1', image, tag: version, label: type });
			expect(reconcileCalls[0]!.imageRef).toBe(`${image}@${DIGEST}`);
		}
	});

	test('passes the recorded ref through so a later tick never re-resolves', async () => {
		reconcileCalls.length = 0;
		await postgresDeployer.reconcile(makeCtx('postgres', dbConfig(), `postgres@${DIGEST}`));
		expect(resolveCalls.at(-1)?.recordedRef).toBe(`postgres@${DIGEST}`);
		expect(reconcileCalls[0]!.imageRef).toBe(`postgres@${DIGEST}`);
	});

	// A database that cannot reach the registry must still boot from its node cache, so the unpinned fallback stays IfNotPresent.
	test('never forces a re-pull, even when the tag could not be pinned', async () => {
		resolvePinned = false;
		reconcileCalls.length = 0;
		try {
			await postgresDeployer.reconcile(makeCtx('postgres', dbConfig()));
		} finally {
			resolvePinned = true;
		}
		expect(reconcileCalls[0]!.imageRef).toBe('postgres:16');
		expect(reconcileCalls[0]!.opts?.mutableTag).toBeUndefined();
	});

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
		expect(reconcileCalls[0]!.imageRef).toBe(`postgres@${DIGEST}`);
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
		expect(reconcileCalls[0]!.imageRef).toBe(`mongo@${DIGEST}`);
		expect(reconcileCalls[0]!.config.containerPort).toBe(27017);
	});

	test('teardown delegates to the shared runtime teardown', async () => {
		teardownCalled = false;
		await postgresDeployer.teardown({ kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' } as TeardownContext);
		expect(teardownCalled).toBe(true);
	});
});
