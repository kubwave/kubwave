import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import type { DeployContext, ReconcileResult, TeardownContext } from '~/modules/worker/jobs/deployments/deployers/types';

const DIGEST = 'sha256:357ec2ceadfc097b09cd1cace7b0645e111b30bf7ac7fc79adf20af2a496a029';

// docker-image is the thinnest deployer: no build, just forms `${image}:${tag}` and funnels through
// the shared runtime core. Stub that core to assert the forwarded image ref and that teardown delegates.
const reconcileCalls: Array<{ imageRef: string; config: unknown; opts: { mutableTag?: boolean } | undefined }> = [];
const resolveCalls: Array<{ image: string; tag: string; registryAuth?: unknown; recordedRef?: string | null }> = [];
let resolvePinned = true;
let teardownCalled = false;

mock.module('~/modules/worker/jobs/deployments/image-ref', () => ({
	resolveDeploymentImageRef: async (args: { image: string; tag: string; registryAuth?: unknown; recordedRef?: string | null }) => {
		resolveCalls.push(args);
		if (args.recordedRef) return { ref: args.recordedRef, pinned: args.recordedRef.includes('@') };
		return resolvePinned ? { ref: `${args.image}@${DIGEST}`, pinned: true } : { ref: `${args.image}:${args.tag}`, pinned: false };
	}
}));
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

function makeCtx(image: string, tag: string, digest?: string, recordedRef?: string): DeployContext {
	return {
		kc,
		namespace: 'kubwave-env-1',
		environmentId: 'env-1',
		deployment: {
			id: 'dep-1',
			serviceId: 'svc-1',
			type: 'docker-image',
			phase: 'applying',
			imageRef: recordedRef ?? null,
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

	// A redeploy of a republished tag would otherwise render an identical pod template, so the Deployment never rolls.
	test('resolves a bare tag to a digest so a redeploy actually produces a new ref', async () => {
		reconcileCalls.length = 0;
		resolveCalls.length = 0;
		const result = await dockerImageDeployer.reconcile(makeCtx('ghcr.io/acme/web', 'next'));
		expect(result).toEqual({ state: 'ready' });
		expect(resolveCalls[0]).toMatchObject({ image: 'ghcr.io/acme/web', tag: 'next' });
		expect(reconcileCalls[0]!.imageRef).toBe(`ghcr.io/acme/web@${DIGEST}`);
		expect(reconcileCalls[0]!.opts?.mutableTag).toBe(false);
	});

	test('uses the tag-watch digest directly, without re-resolving', async () => {
		reconcileCalls.length = 0;
		resolveCalls.length = 0;
		await dockerImageDeployer.reconcile(makeCtx('ghcr.io/acme/web', 'next', DIGEST));
		expect(resolveCalls).toHaveLength(0);
		expect(reconcileCalls[0]!.imageRef).toBe(`ghcr.io/acme/web@${DIGEST}`);
	});

	// Unlike a database, a stateless service prefers a failed pull over silently booting a stale cached layer.
	test('falls back to the tag under Always when the registry could not be reached', async () => {
		resolvePinned = false;
		reconcileCalls.length = 0;
		try {
			await dockerImageDeployer.reconcile(makeCtx('ghcr.io/acme/web', 'next'));
		} finally {
			resolvePinned = true;
		}
		expect(reconcileCalls[0]!.imageRef).toBe('ghcr.io/acme/web:next');
		expect(reconcileCalls[0]!.opts?.mutableTag).toBe(true);
	});

	test('passes per-service registry credentials to the resolver', async () => {
		resolveCalls.length = 0;
		const ctx = makeCtx('ghcr.io/acme/web', 'next');
		(ctx.deployment.config as { registryAuth?: unknown }).registryAuth = { server: 'ghcr.io', username: 'u', password: 'v1:c' };
		await dockerImageDeployer.reconcile(ctx);
		expect(resolveCalls[0]!.registryAuth).toMatchObject({ server: 'ghcr.io' });
	});

	test('reuses the recorded ref so a later tick never re-resolves', async () => {
		reconcileCalls.length = 0;
		await dockerImageDeployer.reconcile(makeCtx('ghcr.io/acme/web', 'next', undefined, `ghcr.io/acme/web@${DIGEST}`));
		expect(reconcileCalls[0]!.imageRef).toBe(`ghcr.io/acme/web@${DIGEST}`);
		expect(reconcileCalls[0]!.opts?.mutableTag).toBe(false);
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
