import { afterEach, describe, expect, mock, test } from 'bun:test';

// Mutable env stub so gating tests can flip flags per-test.
const fakeEnv = {
	registryEndpoint: 'test-registry:5000',
	registryInsecure: false,
	registryPushSecretName: 'registry-creds',
	podNamespace: 'kubwave'
};
mock.module('~/shared/config/worker-env', () => ({ env: fakeEnv }));

// Stub kube module -- kube client must never be called in gating tests that should short-circuit.
const mockMakeApiClient = mock(() => ({}));
mock.module('@kubwave/kube', () => ({ getKubeConfig: () => ({ makeApiClient: mockMakeApiClient }) }));
mock.module('@kubernetes/client-node', () => ({ CoreV1Api: class CoreV1Api {} }));

let fakeSecret: Record<string, unknown> | null = null;
mock.module('~/shared/cluster/ops', () => ({
	readSecretOrNull: async () => fakeSecret
}));

const { basicAuthFromDockerConfig, registryAuthHeaders, resetRegistryAuthCache } = await import('~/modules/worker/jobs/registry/auth');

afterEach(() => {
	resetRegistryAuthCache();
	fakeEnv.registryInsecure = false;
	fakeEnv.registryPushSecretName = 'registry-creds';
	fakeSecret = null;
	mockMakeApiClient.mockClear();
});

describe('basicAuthFromDockerConfig', () => {
	test('(a) returns auth field verbatim when present', () => {
		const config = {
			auths: {
				'test-registry:5000': { auth: 'dXNlcjpwYXNz' }
			}
		};
		const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
		expect(basicAuthFromDockerConfig(encoded)).toBe('dXNlcjpwYXNz');
	});

	test('(b) derives auth from username + password when no auth field', () => {
		const config = {
			auths: {
				'test-registry:5000': { username: 'user', password: 'pass' }
			}
		};
		const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
		const expected = Buffer.from('user:pass').toString('base64');
		expect(basicAuthFromDockerConfig(encoded)).toBe(expected);
	});

	test('(c) returns null for malformed / non-base64 input', () => {
		expect(basicAuthFromDockerConfig('!!!not-base64!!!')).toBeNull();
	});

	test('(d) returns null when auths object is empty', () => {
		const config = { auths: {} };
		const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
		expect(basicAuthFromDockerConfig(encoded)).toBeNull();
	});

	test('returns null when entry has neither auth nor username+password', () => {
		const config = {
			auths: {
				'test-registry:5000': { email: 'user@example.com' }
			}
		};
		const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
		expect(basicAuthFromDockerConfig(encoded)).toBeNull();
	});
});

describe('registryAuthHeaders', () => {
	test('registryInsecure does not disable configured auth', async () => {
		fakeEnv.registryInsecure = true;
		const config = {
			auths: {
				'test-registry:5000': { auth: 'dXNlcjpwYXNz' }
			}
		};
		const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
		fakeSecret = { data: { '.dockerconfigjson': encoded } };
		const headers = await registryAuthHeaders();
		expect(headers).toEqual({ Authorization: 'Basic dXNlcjpwYXNz' });
		expect(mockMakeApiClient).toHaveBeenCalled();
	});

	test('returns {} and skips kube when registryPushSecretName is undefined', async () => {
		fakeEnv.registryPushSecretName = undefined as unknown as string;
		const headers = await registryAuthHeaders();
		expect(headers).toEqual({});
		expect(mockMakeApiClient).not.toHaveBeenCalled();
	});

	test('returns Authorization header when secret is present with auth field', async () => {
		const config = {
			auths: {
				'test-registry:5000': { auth: 'dXNlcjpwYXNz' }
			}
		};
		const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
		fakeSecret = { data: { '.dockerconfigjson': encoded } };
		const headers = await registryAuthHeaders();
		expect(headers).toEqual({ Authorization: 'Basic dXNlcjpwYXNz' });
	});

	test('returns {} when secret exists but yields no usable auth', async () => {
		const config = { auths: {} };
		const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
		fakeSecret = { data: { '.dockerconfigjson': encoded } };
		const headers = await registryAuthHeaders();
		expect(headers).toEqual({});
	});

	test('returns {} when secret is not found', async () => {
		fakeSecret = null;
		const headers = await registryAuthHeaders();
		expect(headers).toEqual({});
	});

	test('reads the registry Secret on every call so rotations take effect', async () => {
		const first = Buffer.from(JSON.stringify({ auths: { 'test-registry:5000': { auth: 'old' } } })).toString('base64');
		const second = Buffer.from(JSON.stringify({ auths: { 'test-registry:5000': { auth: 'new' } } })).toString('base64');

		fakeSecret = { data: { '.dockerconfigjson': first } };
		expect(await registryAuthHeaders()).toEqual({ Authorization: 'Basic old' });

		fakeSecret = { data: { '.dockerconfigjson': second } };
		expect(await registryAuthHeaders()).toEqual({ Authorization: 'Basic new' });
		expect(mockMakeApiClient.mock.calls.length).toBe(2);
	});
});
