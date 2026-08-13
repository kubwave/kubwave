import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import type { DeployContext, ReconcileResult, TeardownContext } from '~/modules/worker/jobs/deployments/deployers/types';

// docker-image is the thinnest deployer: no build, just forms `${image}:${tag}` and funnels through
// the shared runtime core. Stub that core to assert the forwarded image ref and that teardown delegates.
const reconcileCalls: Array<{ imageRef: string; config: unknown; opts: { mutableTag?: boolean } | undefined }> = [];
let teardownCalled = false;
mock.module('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service', () => ({
	reconcileRuntime: async (_ctx: DeployContext, config: unknown, imageRef: string, opts?: { mutableTag?: boolean }): Promise<ReconcileResult> => {
		reconcileCalls.push({ imageRef, config, opts });
		return { state: 'ready' };
	},
	teardownRuntime: async (_ctx: TeardownContext) => {
		teardownCalled = true;
	}
}));

const { dockerImageDeployer } = await import('~/modules/worker/jobs/deployments/deployers/docker-image');

const kc = { makeApiClient: () => ({}) } as unknown as KubeConfig;

function makeCtx(image: string, tag: string, digest?: string): DeployContext {
	return {
		kc,
		namespace: 'kubwave-env-1',
		environmentId: 'env-1',
		deployment: {
			id: 'dep-1',
			serviceId: 'svc-1',
			type: 'docker-image',
			phase: 'applying',
			config: { image, tag, containerPort: 80, env: [], domains: [], volumes: [], ...(digest ? { digest } : {}) }
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

	test('reconcile forwards `${image}@${digest}` when tag-watch pinned one', async () => {
		reconcileCalls.length = 0;
		await dockerImageDeployer.reconcile(
			makeCtx('ghcr.io/acme/web', 'next', 'sha256:357ec2ceadfc097b09cd1cace7b0645e111b30bf7ac7fc79adf20af2a496a029')
		);
		expect(reconcileCalls[0]!.imageRef).toBe('ghcr.io/acme/web@sha256:357ec2ceadfc097b09cd1cace7b0645e111b30bf7ac7fc79adf20af2a496a029');
	});

	// The registry republishes a tag in place, so the node's image cache may hold a far older release under that name.
	test('marks a bare tag as mutable so the pod re-pulls instead of trusting the node cache', async () => {
		reconcileCalls.length = 0;
		await dockerImageDeployer.reconcile(makeCtx('ghcr.io/acme/web', 'next'));
		expect(reconcileCalls[0]!.opts?.mutableTag).toBe(true);
	});

	test('marks a digest-pinned ref as immutable, since content-addressed layers can never go stale', async () => {
		reconcileCalls.length = 0;
		await dockerImageDeployer.reconcile(
			makeCtx('ghcr.io/acme/web', 'next', 'sha256:357ec2ceadfc097b09cd1cace7b0645e111b30bf7ac7fc79adf20af2a496a029')
		);
		expect(reconcileCalls[0]!.opts?.mutableTag).toBe(false);
	});

	test('teardown delegates to teardownRuntime (no build artifacts to reap)', async () => {
		teardownCalled = false;
		await dockerImageDeployer.teardown({ kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' } as TeardownContext);
		expect(teardownCalled).toBe(true);
	});
});
