import { describe, expect, mock, test } from 'bun:test';
import { clackStub } from './support/clack-stub.js';

const logs: string[] = [];

mock.module('@clack/prompts', () => ({
	...clackStub(),
	log: {
		...clackStub().log,
		step: (msg: string) => logs.push(`step:${msg}`),
		success: (msg: string) => logs.push(`success:${msg}`)
	}
}));

const { createSecrets } = await import('../src/lib/secrets.js');

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

		await createSecrets(kc, 'kubwave');
		expect(created).toContain('console-creds');
		expect(created).toContain('postgres-creds');
		expect(created).toContain('postgres-app-creds');
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

		await createSecrets(kc, 'kubwave');
		expect(createCalled).toBe(false);
	});

	test('strips a stale GITHUB_TOKEN from an existing console-creds without rotating the other keys', async () => {
		logs.length = 0;
		let replaced: { name: string; data: Record<string, string> } | null = null;
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async ({ name }: { name: string }) => {
					if (name === 'console-creds') {
						return {
							metadata: { name, resourceVersion: '7' },
							type: 'Opaque',
							data: { JWT_SECRET: 'ag==', SECRETS_KEY: 'Yg==', GITHUB_TOKEN: 'Z2g=' }
						};
					}
					throw { code: 404 };
				},
				createNamespacedSecret: async () => undefined,
				replaceNamespacedSecret: async ({ name, body }: { name: string; body: { data: Record<string, string> } }) => {
					replaced = { name, data: body.data };
				}
			})
		} as never;

		await createSecrets(kc, 'kubwave');
		expect(replaced).not.toBeNull();
		expect(replaced!.name).toBe('console-creds');
		expect(replaced!.data).toEqual({ JWT_SECRET: 'ag==', SECRETS_KEY: 'Yg==' }); // GITHUB_TOKEN dropped, others preserved verbatim
	});

	test('leaves an existing console-creds untouched when it has no GITHUB_TOKEN', async () => {
		logs.length = 0;
		let replaceCalled = false;
		const kc = {
			makeApiClient: () => ({
				readNamespacedSecret: async ({ name }: { name: string }) => {
					if (name === 'console-creds') return { metadata: { name }, type: 'Opaque', data: { JWT_SECRET: 'ag==', SECRETS_KEY: 'Yg==' } };
					throw { code: 404 };
				},
				createNamespacedSecret: async () => undefined,
				replaceNamespacedSecret: async () => {
					replaceCalled = true;
				}
			})
		} as never;

		await createSecrets(kc, 'kubwave');
		expect(replaceCalled).toBe(false);
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

		await createSecrets(kc, 'kubwave');
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

		await expect(createSecrets(kc, 'kubwave')).rejects.toThrow('permission denied');
	});
});
