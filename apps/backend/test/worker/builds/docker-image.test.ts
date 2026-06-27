import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import type { DeployContext, ReconcileResult, TeardownContext } from '~/modules/worker/jobs/deployments/deployers/types';

// docker-image is the thinnest deployer: no build, just forms `${image}:${tag}` and funnels through
// the shared runtime core. Stub that core to assert the forwarded image ref and that teardown delegates.
const reconcileCalls: Array<{ imageRef: string; config: unknown }> = [];
let teardownCalled = false;
mock.module('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service', () => ({
	reconcileRuntime: async (_ctx: DeployContext, config: unknown, imageRef: string): Promise<ReconcileResult> => {
		reconcileCalls.push({ imageRef, config });
		return { state: 'ready' };
	},
	teardownRuntime: async (_ctx: TeardownContext) => {
		teardownCalled = true;
	}
}));

const { dockerImageDeployer } = await import('~/modules/worker/jobs/deployments/deployers/docker-image');

const kc = { makeApiClient: () => ({}) } as unknown as KubeConfig;

function makeCtx(image: string, tag: string): DeployContext {
	return {
		kc,
		namespace: 'kubwave-env-1',
		environmentId: 'env-1',
		deployment: {
			id: 'dep-1',
			serviceId: 'svc-1',
			type: 'docker-image',
			phase: 'applying',
			config: { image, tag, containerPort: 80, env: [], domains: [], volumes: [] }
		} as unknown as DeployContext['deployment'],
		ingress: { className: undefined, clusterIssuer: undefined, annotations: {} },
		defaultDomainHost: null
	};
}

describe('dockerImageDeployer', () => {
	test('declares the docker-image service type', () => {
		expect(dockerImageDeployer.type).toBe('docker-image');
	});

	test('reconcile forwards `${image}:${tag}` to the shared runtime core and returns its result', async () => {
		reconcileCalls.length = 0;
		const result = await dockerImageDeployer.reconcile(makeCtx('ghcr.io/acme/web', '1.2.3'));
		expect(result).toEqual({ state: 'ready' });
		expect(reconcileCalls).toHaveLength(1);
		expect(reconcileCalls[0]!.imageRef).toBe('ghcr.io/acme/web:1.2.3');
	});

	test('passes the deployment config through to reconcileRuntime unchanged', async () => {
		reconcileCalls.length = 0;
		await dockerImageDeployer.reconcile(makeCtx('nginx', 'latest'));
		expect(reconcileCalls[0]!.config).toMatchObject({ image: 'nginx', tag: 'latest' });
	});

	test('teardown delegates to teardownRuntime (no build artifacts to reap)', async () => {
		teardownCalled = false;
		await dockerImageDeployer.teardown({ kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' } as TeardownContext);
		expect(teardownCalled).toBe(true);
	});
});
