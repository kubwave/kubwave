import { describe, expect, test } from 'bun:test';
import { createRegistryPushSecret, createRegistrySecrets } from '../src/lib/secrets.js';
import { REGISTRY_PUSH_SECRET_NAME } from '../src/lib/constants.js';

const REGISTRY_HOST = 'registry.app.example.com';

interface SecretCall {
	op: 'create' | 'replace';
	name: string;
	body: { stringData?: Record<string, string> };
}

function dockerConfigSecret(password: string) {
	const dockerConfigJson = JSON.stringify({
		auths: { [REGISTRY_HOST]: { username: 'kubwave', password, auth: Buffer.from(`kubwave:${password}`).toString('base64') } }
	});
	return { data: { '.dockerconfigjson': Buffer.from(dockerConfigJson).toString('base64') } };
}

function fakeApi(existing: Record<string, unknown>) {
	const calls: SecretCall[] = [];
	const api = {
		async readNamespacedSecret({ name }: { name: string }) {
			if (name in existing) return existing[name];
			throw { code: 404 };
		},
		async createNamespacedSecret({ body }: { body: SecretCall['body'] & { metadata: { name: string } } }) {
			calls.push({ op: 'create', name: body.metadata.name, body });
		},
		async replaceNamespacedSecret({ name, body }: { name: string; body: SecretCall['body'] }) {
			calls.push({ op: 'replace', name, body });
		}
	};
	return { calls, kc: { makeApiClient: () => api } as never };
}

describe('createRegistrySecrets', () => {
	test('leaves both secrets untouched when they already exist', async () => {
		const { calls, kc } = fakeApi({ 'registry-htpasswd': {}, 'registry-creds': dockerConfigSecret('existing-pw') });

		await createRegistrySecrets(kc, REGISTRY_HOST);

		expect(calls).toEqual([]);
	});

	test('creates both secrets from scratch when neither exists', async () => {
		const { calls, kc } = fakeApi({});

		await createRegistrySecrets(kc, REGISTRY_HOST);

		expect(calls.map(c => `${c.op}:${c.name}`)).toEqual(['create:registry-htpasswd', 'create:registry-creds']);
	});

	test('recovers the live password and re-derives the htpasswd without touching registry-creds', async () => {
		const livePassword = 'live-password-123';
		const { calls, kc } = fakeApi({ 'registry-creds': dockerConfigSecret(livePassword) });

		await createRegistrySecrets(kc, REGISTRY_HOST);

		// Only the htpasswd is (re)written; registry-creds is left as-is so distributed pull secrets keep working.
		expect(calls.map(c => `${c.op}:${c.name}`)).toEqual(['create:registry-htpasswd']);

		const htpasswd = calls[0]!.body.stringData!['htpasswd']!;
		const [username, hash] = htpasswd.split(':', 2) as [string, string];
		expect(username).toBe('kubwave');
		// The htpasswd must encode the RECOVERED password, not a freshly generated one.
		expect(await Bun.password.verify(livePassword, hash)).toBe(true);
	});

	test('regenerates both secrets when the password cannot be recovered (htpasswd present, creds missing)', async () => {
		const { calls, kc } = fakeApi({ 'registry-htpasswd': {} });

		await createRegistrySecrets(kc, REGISTRY_HOST);

		expect(calls.map(c => `${c.op}:${c.name}`)).toEqual(['replace:registry-htpasswd', 'create:registry-creds']);
	});

	test('regenerates registry-creds when the existing dockerconfig is unreadable', async () => {
		const brokenDockerConfig = { data: { '.dockerconfigjson': Buffer.from('not-json').toString('base64') } };
		const { calls, kc } = fakeApi({ 'registry-creds': brokenDockerConfig });

		await createRegistrySecrets(kc, REGISTRY_HOST);

		expect(calls.map(c => `${c.op}:${c.name}`)).toEqual(['create:registry-htpasswd', 'replace:registry-creds']);
	});

	test('rethrows non-not-found read errors while checking registry secrets', async () => {
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async () => {
					throw new Error('permission denied');
				}
			})
		} as never;

		await expect(createRegistrySecrets(kc, REGISTRY_HOST)).rejects.toThrow('permission denied');
	});
});

test('createRegistryPushSecret writes a dockerconfigjson keyed on the registry host', async () => {
	const { calls, kc } = fakeApi({});

	await createRegistryPushSecret(kc, 'ghcr.io', 'kubwave', 's3cr3t');

	expect(calls).toHaveLength(1);
	expect(calls[0]!.name).toBe(REGISTRY_PUSH_SECRET_NAME);
	expect(calls[0]!.body).toMatchObject({ type: 'kubernetes.io/dockerconfigjson' });
	const cfg = JSON.parse((calls[0]!.body as any).stringData['.dockerconfigjson']);
	expect(cfg.auths['ghcr.io'].username).toBe('kubwave');
	expect(cfg.auths['ghcr.io'].auth).toBe(Buffer.from('kubwave:s3cr3t').toString('base64'));
});
