import { describe, expect, mock, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import type { CoreV1Api, V1Secret } from '@kubernetes/client-node';
import type { DeploymentLogEntry, RegistryAuthConfig } from '@kubwave/db';
import { encryptSecret } from '@kubwave/crypto';

process.env.SECRETS_KEY = randomBytes(32).toString('base64url');

// convergePullSecret copies the platform push creds into the env namespace as a pull Secret; only ~/env is mocked.
let pullName: string | undefined = 'reg-pull';
let pushName: string | undefined = 'registry-creds';
mock.module('~/shared/config/worker-env', () => ({
	env: {
		podNamespace: 'kubwave',
		get registryPullSecretName() {
			return pullName;
		},
		get registryPushSecretName() {
			return pushName;
		}
	}
}));

const { convergePullSecret, convergeServicePullSecret, buildServicePullSecret } =
	await import('~/modules/worker/jobs/deployments/deployers/runtime/pull-secret');

const NAMESPACE = 'kubwave-env-1';

// Fake CoreV1Api: reads resolve from a name→secret map (404 when missing), creates/replaces recorded.
function fakeApi(secrets: Record<string, V1Secret>) {
	const created: Array<{ namespace: string; body: V1Secret }> = [];
	const replaced: Array<{ name: string; namespace: string; body: V1Secret }> = [];
	const removed: string[] = [];
	const api = {
		readNamespacedSecret: async ({ name }: { name: string }) => {
			const s = secrets[name];
			if (!s) throw { code: 404 };
			return s;
		},
		createNamespacedSecret: async (args: { namespace: string; body: V1Secret }) => {
			created.push(args);
			secrets[args.body.metadata!.name!] = args.body;
			return args.body;
		},
		replaceNamespacedSecret: async (args: { name: string; namespace: string; body: V1Secret }) => {
			replaced.push(args);
			secrets[args.name] = args.body;
			return args.body;
		},
		deleteNamespacedSecret: async (args: { name: string }) => {
			if (!secrets[args.name]) throw { code: 404 };
			removed.push(args.name);
			delete secrets[args.name];
		}
	} as unknown as CoreV1Api;
	return { api, created, replaced, removed };
}

const dockerCfgB64 = Buffer.from('{"auths":{}}').toString('base64');

describe('convergePullSecret', () => {
	test('no-op when the registry is anonymous (names unset)', async () => {
		pullName = undefined;
		pushName = undefined;
		const events: DeploymentLogEntry[] = [];
		const { api, created } = fakeApi({});
		await convergePullSecret(api, NAMESPACE, events);
		expect(created).toEqual([]);
		expect(events).toEqual([]);
		pullName = 'reg-pull';
		pushName = 'registry-creds';
	});

	test('no-op when the pull Secret already exists in the namespace', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, created, replaced } = fakeApi({
			'registry-creds': { metadata: { name: 'registry-creds', namespace: 'kubwave' }, data: { '.dockerconfigjson': dockerCfgB64 } },
			'reg-pull': {
				metadata: { name: 'reg-pull', namespace: NAMESPACE },
				type: 'kubernetes.io/dockerconfigjson',
				data: { '.dockerconfigjson': dockerCfgB64 }
			}
		});
		await convergePullSecret(api, NAMESPACE, events);
		expect(created).toEqual([]);
		expect(replaced).toEqual([]);
		expect(events).toEqual([]);
	});

	test('no-op when the platform source creds are not present yet', async () => {
		const events: DeploymentLogEntry[] = [];
		// source secret exists but has no .dockerconfigjson key
		const { api, created } = fakeApi({ 'registry-creds': { metadata: { name: 'registry-creds' }, data: {} } });
		await convergePullSecret(api, NAMESPACE, events);
		expect(created).toEqual([]);
		expect(events).toEqual([]);
	});

	test('no-op when the platform source Secret itself is missing (404)', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, created } = fakeApi({}); // neither target nor source present
		await convergePullSecret(api, NAMESPACE, events);
		expect(created).toEqual([]);
		expect(events).toEqual([]);
	});

	test('copies the dockerconfigjson into a namespaced pull Secret and logs a step', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, created } = fakeApi({
			'registry-creds': { metadata: { name: 'registry-creds', namespace: 'kubwave' }, data: { '.dockerconfigjson': dockerCfgB64 } }
		});
		await convergePullSecret(api, NAMESPACE, events);
		expect(created).toHaveLength(1);
		const body = created[0]!.body;
		expect(created[0]!.namespace).toBe(NAMESPACE);
		expect(body.metadata?.name).toBe('reg-pull');
		expect(body.metadata?.namespace).toBe(NAMESPACE);
		expect(body.type).toBe('kubernetes.io/dockerconfigjson');
		expect(body.data?.['.dockerconfigjson']).toBe(dockerCfgB64);
		expect(events).toHaveLength(1);
		expect(events[0]?.step).toBe('pull-secret-converged');
	});

	test('updates an existing pull Secret when platform registry creds rotate', async () => {
		const events: DeploymentLogEntry[] = [];
		const oldCfg = Buffer.from('{"auths":{"registry":{"auth":"old"}}}').toString('base64');
		const newCfg = Buffer.from('{"auths":{"registry":{"auth":"new"}}}').toString('base64');
		const { api, created, replaced } = fakeApi({
			'registry-creds': { metadata: { name: 'registry-creds', namespace: 'kubwave' }, data: { '.dockerconfigjson': newCfg } },
			'reg-pull': {
				metadata: { name: 'reg-pull', namespace: NAMESPACE, resourceVersion: '7' },
				type: 'kubernetes.io/dockerconfigjson',
				data: { '.dockerconfigjson': oldCfg }
			}
		});

		await convergePullSecret(api, NAMESPACE, events);

		expect(created).toEqual([]);
		expect(replaced).toHaveLength(1);
		expect(replaced[0]?.body.metadata?.resourceVersion).toBe('7');
		expect(replaced[0]?.body.data?.['.dockerconfigjson']).toBe(newCfg);
		expect(events[0]?.message).toContain('Updated registry pull Secret reg-pull');
	});
});

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function registryAuth(password: string): RegistryAuthConfig {
	return { server: 'ghcr.io', username: 'octocat', password: encryptSecret(password) };
}

function parseDockerConfig(secret: V1Secret): { auths: Record<string, { username: string; password: string; auth: string }> } {
	return JSON.parse(Buffer.from(secret.data?.['.dockerconfigjson'] ?? '', 'base64').toString('utf8'));
}

describe('convergeServicePullSecret', () => {
	test('creates a dockerconfigjson Secret keyed by the registry server', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, created } = fakeApi({});
		await convergeServicePullSecret(api, NAMESPACE, SERVICE_ID, registryAuth('s3cret'), events);
		expect(created).toHaveLength(1);
		const body = created[0]!.body;
		expect(created[0]!.namespace).toBe(NAMESPACE);
		expect(body.metadata?.name).toBe(`svc-${SERVICE_ID}-registry`);
		expect(body.type).toBe('kubernetes.io/dockerconfigjson');
		const cfg = parseDockerConfig(body);
		expect(cfg.auths['ghcr.io']).toEqual({ username: 'octocat', password: 's3cret', auth: Buffer.from('octocat:s3cret').toString('base64') });
		expect(events[0]?.step).toBe('registry-secret-converged');
	});

	test('normalizes Docker Hub servers to the legacy index URL like docker login', () => {
		const secret = buildServicePullSecret(NAMESPACE, SERVICE_ID, 'svc-x-registry', { ...registryAuth('p'), server: 'docker.io' });
		expect(parseDockerConfig(secret).auths['https://index.docker.io/v1/']).toBeDefined();
		expect(parseDockerConfig(secret).auths['docker.io']).toBeUndefined();
	});

	test('replaces the Secret when credentials change', async () => {
		const events: DeploymentLogEntry[] = [];
		const oldAuth = registryAuth('old-pass');
		const { api, created, replaced } = fakeApi({
			[`svc-${SERVICE_ID}-registry`]: {
				metadata: { name: `svc-${SERVICE_ID}-registry`, namespace: NAMESPACE, resourceVersion: '7' },
				type: 'kubernetes.io/dockerconfigjson',
				data: { '.dockerconfigjson': Buffer.from(JSON.stringify({ auths: {} })).toString('base64') }
			}
		});
		await convergeServicePullSecret(api, NAMESPACE, SERVICE_ID, { ...oldAuth, password: encryptSecret('new-pass') }, events);
		expect(created).toEqual([]);
		expect(replaced).toHaveLength(1);
		expect(replaced[0]?.body.metadata?.resourceVersion).toBe('7');
		expect(parseDockerConfig(replaced[0]!.body).auths['ghcr.io']!.password).toBe('new-pass');
	});

	test('no-op when the Secret already matches', async () => {
		const events: DeploymentLogEntry[] = [];
		const auth = registryAuth('s3cret');
		const desired = buildServicePullSecret(NAMESPACE, SERVICE_ID, `svc-${SERVICE_ID}-registry`, auth);
		const { api, created, replaced } = fakeApi({ [`svc-${SERVICE_ID}-registry`]: desired });
		await convergeServicePullSecret(api, NAMESPACE, SERVICE_ID, auth, events);
		expect(created).toEqual([]);
		expect(replaced).toEqual([]);
		expect(events).toEqual([]);
	});

	test('deletes the Secret when credentials are removed', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, created, removed } = fakeApi({
			[`svc-${SERVICE_ID}-registry`]: { metadata: { name: `svc-${SERVICE_ID}-registry` }, type: 'kubernetes.io/dockerconfigjson', data: {} }
		});
		await convergeServicePullSecret(api, NAMESPACE, SERVICE_ID, undefined, events);
		expect(created).toEqual([]);
		expect(removed).toEqual([`svc-${SERVICE_ID}-registry`]);
		expect(events[0]?.message).toContain('Removed registry pull Secret');
	});

	test('no-op when no credentials and no Secret exists', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, created, removed } = fakeApi({});
		await convergeServicePullSecret(api, NAMESPACE, SERVICE_ID, undefined, events);
		expect(created).toEqual([]);
		expect(removed).toEqual([]);
		expect(events).toEqual([]);
	});
});
