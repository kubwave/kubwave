import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import type { CoreV1Api, V1Secret } from '@kubernetes/client-node';
import type { Deployment, DeploymentLogEntry, DockerImageServiceConfig } from '@kubwave/db';
import { encryptSecret } from '@kubwave/crypto';
import { buildDeployment, deploymentMatchesConfig } from '~/modules/worker/jobs/deployments/deployers/runtime/deployment';
import { buildSecret, convergeSecret, secretMatches } from '~/modules/worker/jobs/deployments/deployers/runtime/secrets';

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const SECRET_NAME = `svc-${SERVICE_ID}-env`;
// The deploy core takes the image ref explicitly; for a docker-image config it's `${image}:${tag}`, i.e. nginx:latest here.
const IMAGE_REF = 'nginx:latest';
const deployment = { serviceId: SERVICE_ID } as Deployment;

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

function configWith(secrets: DockerImageServiceConfig['secrets'], env: DockerImageServiceConfig['env'] = []): DockerImageServiceConfig {
	return { image: 'nginx', tag: 'latest', containerPort: 8080, env, domains: [], volumes: [], ...(secrets ? { secrets } : {}) };
}

// The container references secrets via secretKeyRef — their plaintext must never land inline.
describe('buildDeployment secret injection', () => {
	test('plaintext env stays inline; secrets become secretKeyRef entries', () => {
		const config = configWith([{ key: 'API_KEY', value: encryptSecret('s3cr3t') }], [{ key: 'PUBLIC', value: 'hello' }]);
		const container = buildDeployment(deployment, NAMESPACE, config, IMAGE_REF).spec!.template!.spec!.containers[0]!;
		const env = container.env ?? [];

		const pub = env.find(e => e.name === 'PUBLIC');
		expect(pub?.value).toBe('hello');
		expect(pub?.valueFrom).toBeUndefined();

		const secret = env.find(e => e.name === 'API_KEY');
		expect(secret?.value).toBeUndefined();
		expect(secret?.valueFrom?.secretKeyRef).toEqual({ name: SECRET_NAME, key: 'API_KEY' });
		// Plaintext must not appear anywhere in the rendered manifest.
		expect(JSON.stringify(container)).not.toContain('s3cr3t');
	});

	test('stamps a secrets checksum annotation only when secrets exist', () => {
		const withSecrets = buildDeployment(deployment, NAMESPACE, configWith([{ key: 'A', value: encryptSecret('1') }]), IMAGE_REF);
		expect(withSecrets.spec?.template?.metadata?.annotations?.['kubwave/secrets-checksum']).toBeString();
		const without = buildDeployment(deployment, NAMESPACE, configWith([]), IMAGE_REF);
		expect(without.spec?.template?.metadata?.annotations).toBeUndefined();
	});
});

// A secretKeyRef change doesn't restart pods, so a value change must surface as a config mismatch (via the checksum) to force a rollout.
describe('deploymentMatchesConfig with secrets', () => {
	test('a converged Deployment matches its own config', () => {
		const config = configWith([{ key: 'API_KEY', value: encryptSecret('v1') }]);
		const built = buildDeployment(deployment, NAMESPACE, config, IMAGE_REF);
		expect(deploymentMatchesConfig(built, config, IMAGE_REF, SERVICE_ID)).toBe(true);
	});

	test('a changed secret value (different ciphertext) is a mismatch', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith([{ key: 'API_KEY', value: encryptSecret('v1') }]), IMAGE_REF);
		const next = configWith([{ key: 'API_KEY', value: encryptSecret('v2') }]);
		expect(deploymentMatchesConfig(built, next, IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	test('adding a secret key is a mismatch', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith([{ key: 'A', value: encryptSecret('1') }]), IMAGE_REF);
		const next = configWith([
			{ key: 'A', value: encryptSecret('1') },
			{ key: 'B', value: encryptSecret('2') }
		]);
		expect(deploymentMatchesConfig(built, next, IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	test('removing all secrets is a mismatch (annotation drops)', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith([{ key: 'A', value: encryptSecret('1') }]), IMAGE_REF);
		expect(deploymentMatchesConfig(built, configWith([]), IMAGE_REF, SERVICE_ID)).toBe(false);
	});
});

describe('buildSecret / secretMatches', () => {
	test('buildSecret decrypts values into stringData', () => {
		const config = configWith([{ key: 'API_KEY', value: encryptSecret('plaintext-value') }]);
		const secret = buildSecret(SERVICE_ID, NAMESPACE, config);
		expect(secret.metadata?.name).toBe(SECRET_NAME);
		expect(secret.stringData).toEqual({ API_KEY: 'plaintext-value' });
	});

	test('secretMatches compares decoded live data against desired plaintext', () => {
		const desired = buildSecret(SERVICE_ID, NAMESPACE, configWith([{ key: 'API_KEY', value: encryptSecret('val') }]));
		// API server returns base64 `data`, not `stringData`.
		const liveMatch: V1Secret = { data: { API_KEY: Buffer.from('val').toString('base64') } };
		const liveDiff: V1Secret = { data: { API_KEY: Buffer.from('other').toString('base64') } };
		expect(secretMatches(liveMatch, desired)).toBe(true);
		expect(secretMatches(liveDiff, desired)).toBe(false);
	});

	test('a differing key SET is a mismatch (length / membership)', () => {
		const desired = buildSecret(SERVICE_ID, NAMESPACE, configWith([{ key: 'A', value: encryptSecret('1') }]));
		// extra live key
		expect(secretMatches({ data: { A: Buffer.from('1').toString('base64'), B: Buffer.from('2').toString('base64') } }, desired)).toBe(false);
		// renamed live key (same count, different membership)
		expect(secretMatches({ data: { Z: Buffer.from('1').toString('base64') } }, desired)).toBe(false);
	});
});

// Fake CoreV1Api over a name→secret map (404 when missing); drives convergeSecret through the real ops helpers.
function fakeApi(initial: Record<string, V1Secret> = {}) {
	const store = { ...initial };
	const calls = { create: 0, replace: 0, delete: 0 };
	const api = {
		readNamespacedSecret: async ({ name }: { name: string }) => {
			const s = store[name];
			if (!s) throw { code: 404 };
			return s;
		},
		createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
			calls.create++;
			store[body.metadata!.name!] = body;
			return body;
		},
		replaceNamespacedSecret: async ({ name, body }: { name: string; body: V1Secret }) => {
			calls.replace++;
			store[name] = body;
			return body;
		},
		deleteNamespacedSecret: async ({ name }: { name: string }) => {
			calls.delete++;
			delete store[name];
			return {};
		}
	} as unknown as CoreV1Api;
	return { api, calls, store };
}

// A live Secret as the API server returns it: base64 `data`, not `stringData`.
function liveSecret(data: Record<string, string>): V1Secret {
	return {
		metadata: { name: SECRET_NAME, namespace: NAMESPACE, resourceVersion: '42' },
		data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Buffer.from(v).toString('base64')]))
	};
}

describe('convergeSecret', () => {
	test('creates the Secret when secrets exist and none is live', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi();
		await convergeSecret(api, NAMESPACE, SERVICE_ID, configWith([{ key: 'API_KEY', value: encryptSecret('v1') }]), events);
		expect(calls).toEqual({ create: 1, replace: 0, delete: 0 });
		expect(events.map(e => e.step)).toEqual(['secret-converged']);
		expect(events[0]?.message).toContain('Created Secret');
	});

	test('no-op when the live Secret already matches the desired plaintext', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi({ [SECRET_NAME]: liveSecret({ API_KEY: 'v1' }) });
		await convergeSecret(api, NAMESPACE, SERVICE_ID, configWith([{ key: 'API_KEY', value: encryptSecret('v1') }]), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(events).toEqual([]); // idempotent: nothing written, nothing logged
	});

	test('replaces the live Secret when a value changed', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi({ [SECRET_NAME]: liveSecret({ API_KEY: 'old' }) });
		await convergeSecret(api, NAMESPACE, SERVICE_ID, configWith([{ key: 'API_KEY', value: encryptSecret('new') }]), events);
		expect(calls).toEqual({ create: 0, replace: 1, delete: 0 });
		expect(events[0]?.message).toContain('Updated Secret');
	});

	test('deletes the live Secret when the config has no secrets left', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi({ [SECRET_NAME]: liveSecret({ API_KEY: 'v1' }) });
		await convergeSecret(api, NAMESPACE, SERVICE_ID, configWith([]), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 1 });
		expect(events[0]?.message).toContain('Removed Secret');
	});

	test('no-op (no delete, no event) when there are no secrets and none is live', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi();
		await convergeSecret(api, NAMESPACE, SERVICE_ID, configWith([]), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(events).toEqual([]);
	});
});
