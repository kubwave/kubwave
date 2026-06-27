import { describe, expect, mock, test } from 'bun:test';

const logs: string[] = [];

mock.module('@clack/prompts', () => ({
	log: {
		step: (msg: string) => logs.push(`step:${msg}`),
		success: (msg: string) => logs.push(`success:${msg}`)
	}
}));

const { createSecrets, createImagePullSecret } = await import('../src/lib/secrets.js');

describe('createSecrets', () => {
	test('creates all secrets from scratch when none exist', async () => {
		logs.length = 0;
		const created: string[] = [];
		const kc = {
			makeApiClient: () => ({
				async readNamespacedSecret(_args: { name: string }) {
					throw { code: 404 };
				},
				async createNamespacedSecret({ body }: { body: { metadata: { name: string; namespace?: string } } }) {
					created.push(body.metadata.name);
				}
			})
		} as never;

		await createSecrets(kc, undefined, 'kubwave');
		expect(created).toContain('console-creds');
		expect(created).toContain('postgres-creds');
		expect(created).toContain('postgres-app-creds');
	});

	test('includes GitHub token in console-creds when provided', async () => {
		logs.length = 0;
		const created: Array<{ name: string; data: Record<string, string> }> = [];
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async (_args: { name: string }) => {
					throw { code: 404 };
				},
				createNamespacedSecret: async ({ body }: { body: { metadata: { name: string }; stringData?: Record<string, string> } }) => {
					created.push({ name: body.metadata.name, data: body.stringData ?? {} });
				}
			})
		} as never;

		await createSecrets(kc, 'test-github-token', 'kubwave');
		const consoleCreds = created.find(c => c.name === 'console-creds');
		expect(consoleCreds?.data['GITHUB_TOKEN']).toBe('test-github-token');
	});

	test('skips existing secrets', async () => {
		logs.length = 0;
		let createCalled = false;
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async () => ({ metadata: { name: 'existing' } }),
				createNamespacedSecret: async () => {
					createCalled = true;
					throw new Error('should not create');
				}
			})
		} as never;

		await createSecrets(kc, undefined, 'kubwave');
		expect(createCalled).toBe(false);
	});

	test('reuses existing postgres password when postgres-creds exists', async () => {
		logs.length = 0;
		const existingPassword = 'existing-pg-password';
		const encodedPw = Buffer.from(existingPassword).toString('base64');

		const created: Array<{ name: string; data: Record<string, string> }> = [];
		let postgresRead = false;

		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async ({ name }: { name: string }) => {
					if (name === 'postgres-creds' && !postgresRead) {
						postgresRead = true;
						return { data: { POSTGRES_PASSWORD: encodedPw } };
					}
					throw { code: 404 };
				},
				createNamespacedSecret: async ({ body }: { body: { metadata: { name: string }; stringData?: Record<string, string> } }) => {
					created.push({ name: body.metadata.name, data: body.stringData ?? {} });
				}
			})
		} as never;

		await createSecrets(kc, undefined, 'kubwave');
		const pgCreds = created.find(c => c.name === 'postgres-creds');
		expect(pgCreds?.data['POSTGRES_PASSWORD']).toBe(existingPassword);
	});

	test('rethrows non-not-found errors during secret reads', async () => {
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async () => {
					throw new Error('permission denied');
				}
			})
		} as never;

		await expect(createSecrets(kc, undefined, 'kubwave')).rejects.toThrow('permission denied');
	});
});

describe('createImagePullSecret', () => {
	test('creates image pull secret when it does not exist', async () => {
		logs.length = 0;
		const created: string[] = [];
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async () => {
					throw { code: 404 };
				},
				createNamespacedSecret: async ({ body }: { body: { metadata: { name: string } } }) => {
					created.push(body.metadata.name);
				}
			})
		} as never;

		await createImagePullSecret(kc, 'registry.example.com', 'user', 'pass', 'kubwave');
		expect(created).toContain('regcred');
	});

	test('replaces existing image pull secret', async () => {
		logs.length = 0;
		const replaced: string[] = [];
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async () => ({ metadata: { name: 'regcred' } }),
				replaceNamespacedSecret: async ({ name }: { name: string }) => {
					replaced.push(name);
				}
			})
		} as never;

		await createImagePullSecret(kc, 'registry.example.com', 'user', 'pass', 'kubwave');
		expect(replaced).toContain('regcred');
	});

	test('rethrows non-not-found errors', async () => {
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async () => {
					throw new Error('forbidden');
				}
			})
		} as never;

		await expect(createImagePullSecret(kc, 'reg', 'u', 'p', 'ns')).rejects.toThrow('forbidden');
	});
});
