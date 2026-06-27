import { afterEach, describe, expect, mock, test } from 'bun:test';

// Stub env (registryInsecure=false so imageExists uses https and reaches the auth path).
mock.module('~/shared/config/worker-env', () => ({
	env: {
		podNamespace: 'kubwave',
		registryEndpoint: 'test-registry:5000',
		registryInsecure: false
	}
}));

// Stub transitive deps so the module graph resolves regardless of test load order.
mock.module('@kubwave/db', () => ({ db: {}, deployments: {}, deploymentLogs: {} }));
mock.module('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service', () => ({
	reconcileRuntime: async () => ({ state: 'progressing', phase: 'rolling-out', events: [] }),
	teardownRuntime: async () => {}
}));

mock.module('~/modules/worker/jobs/registry/auth', () => ({
	registryAuthHeaders: async () => ({ Authorization: 'Basic abc' })
}));

const { imageExists } = await import('~/modules/worker/jobs/deployments/builds/service');

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('imageExists auth header forwarding', () => {
	test('forwards the Authorization header from registryAuthHeaders into the manifest HEAD request', async () => {
		let capturedHeaders: RequestInit['headers'];
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			capturedHeaders = init?.headers;
			return { status: 200 };
		}) as unknown as typeof fetch;

		await imageExists('test-registry:5000/env-e1/svc-abc:dep-1');

		const headers = capturedHeaders as Record<string, string>;
		expect(headers?.['Authorization']).toBe('Basic abc');
		// The Accept header must also be present — the spread must not drop it.
		expect(headers?.['Accept']).toContain('application/vnd.docker.distribution.manifest.v2+json');
	});
});
