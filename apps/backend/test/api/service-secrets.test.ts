import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret } from '@kubwave/crypto';
import { buildStoredConfig, resolveRegistryAuth, resolveSecrets, toConfigView } from '~/modules/services/services.config';
import type { RegistryAuthConfig, ServiceConfig } from '@kubwave/db';

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

// resolveSecrets merges a write against stored ciphertext: encrypt fresh values, keep nulls with a stored counterpart, drop the rest ("blank = unchanged").
describe('resolveSecrets', () => {
	test('encrypts a fresh value (round-trips, never stores plaintext)', () => {
		const out = resolveSecrets([{ key: 'API_KEY', value: 'plaintext' }], []);
		expect(out).toHaveLength(1);
		expect(out[0]!.key).toBe('API_KEY');
		expect(out[0]!.value).not.toBe('plaintext');
		expect(decryptSecret(out[0]!.value)).toBe('plaintext');
	});

	test('a null value keeps the existing ciphertext for that key', () => {
		const existing = [{ key: 'API_KEY', value: 'EXISTING_CIPHERTEXT' }];
		const out = resolveSecrets([{ key: 'API_KEY', value: null }], existing);
		expect(out).toEqual([{ key: 'API_KEY', value: 'EXISTING_CIPHERTEXT' }]);
	});

	test('a null value with no stored counterpart is dropped', () => {
		expect(resolveSecrets([{ key: 'GHOST', value: null }], [])).toEqual([]);
	});

	test('keys absent from the incoming list are removed', () => {
		const existing = [
			{ key: 'KEEP', value: 'C1' },
			{ key: 'DROP', value: 'C2' }
		];
		const out = resolveSecrets([{ key: 'KEEP', value: null }], existing);
		expect(out.map(s => s.key)).toEqual(['KEEP']);
	});

	test('re-typing an existing key replaces its ciphertext', () => {
		const existing = [{ key: 'API_KEY', value: 'OLD_CIPHERTEXT' }];
		const out = resolveSecrets([{ key: 'API_KEY', value: 'new-value' }], existing);
		expect(out[0]!.value).not.toBe('OLD_CIPHERTEXT');
		expect(decryptSecret(out[0]!.value)).toBe('new-value');
	});
});

// The read view must never expose secret ciphertext — only which keys are set.
describe('toConfigView', () => {
	test('strips secret values, keeps key + hasValue', () => {
		const stored: ServiceConfig = {
			image: 'nginx',
			tag: 'latest',
			containerPort: 80,
			env: [{ key: 'PUBLIC', value: 'hello' }],
			secrets: [{ key: 'API_KEY', value: 'SOME_CIPHERTEXT' }],
			domains: [],
			volumes: []
		};
		const view = toConfigView(stored);
		expect(view.secrets).toEqual([{ key: 'API_KEY', hasValue: true }]);
		// Plaintext env is fine to expose; ciphertext must be gone.
		expect(view.env).toEqual([{ key: 'PUBLIC', value: 'hello' }]);
		expect(JSON.stringify(view)).not.toContain('SOME_CIPHERTEXT');
	});

	test('defaults secrets to [] for rows persisted before the field existed', () => {
		const stored = { image: 'nginx', tag: 'latest', containerPort: null, env: [], domains: [], volumes: [] } as ServiceConfig;
		expect(toConfigView(stored).secrets).toEqual([]);
	});
});

// Registry credentials are the same sensitive pattern as secrets: ciphertext at rest, hasValue-only in views, null = keep.
describe('resolveRegistryAuth', () => {
	test('encrypts the password when enabled', () => {
		const out = resolveRegistryAuth({ enabled: true, server: 'ghcr.io', username: 'octocat', password: 's3cret' }, undefined);
		expect(out).not.toBeUndefined();
		expect(out!.server).toBe('ghcr.io');
		expect(out!.password).not.toBe('s3cret');
		expect(decryptSecret(out!.password)).toBe('s3cret');
	});

	test('null password keeps the stored ciphertext and applies the new server/username', () => {
		const existing: RegistryAuthConfig = { server: 'ghcr.io', username: 'old', password: 'STORED_CIPHERTEXT' };
		const out = resolveRegistryAuth({ enabled: true, server: 'ghcr.io', username: 'new-user', password: null }, existing);
		expect(out).toEqual({ server: 'ghcr.io', username: 'new-user', password: 'STORED_CIPHERTEXT' });
	});

	test('disabled (or absent) input removes stored credentials', () => {
		const existing: RegistryAuthConfig = { server: 'ghcr.io', username: 'u', password: 'C' };
		expect(resolveRegistryAuth({ enabled: false }, existing)).toBeUndefined();
		expect(resolveRegistryAuth(undefined, existing)).toBeUndefined();
	});

	test('throws when enabled without a password and none is stored', () => {
		expect(() => resolveRegistryAuth({ enabled: true, server: 'ghcr.io', username: 'u' }, undefined)).toThrow();
	});

	test('trims server and username', () => {
		const out = resolveRegistryAuth({ enabled: true, server: '  ghcr.io  ', username: '  octo  ', password: 'p' }, undefined);
		expect(out).toEqual({ server: 'ghcr.io', username: 'octo', password: expect.stringMatching(/^v1:/) });
	});
});

describe('buildStoredConfig registry auth', () => {
	const input = {
		image: 'ghcr.io/acme/web',
		tag: 'latest',
		containerPort: null,
		env: [],
		secrets: [],
		configFiles: [],
		domains: [],
		volumes: []
	};

	test('encrypts registryAuth at rest and exposes only hasPassword via the view', () => {
		const stored = buildStoredConfig({ ...input, registryAuth: { enabled: true, server: 'ghcr.io', username: 'octocat', password: 's3cret' } }, []);
		expect(stored.registryAuth).not.toBeUndefined();
		expect(stored.registryAuth!.password).not.toBe('s3cret');
		expect(decryptSecret(stored.registryAuth!.password)).toBe('s3cret');

		const view = toConfigView(stored);
		const registryAuthView = 'registryAuth' in view ? view.registryAuth : undefined;
		expect(registryAuthView).toEqual({ enabled: true, server: 'ghcr.io', username: 'octocat', hasPassword: true });
		expect(JSON.stringify(view)).not.toContain('s3cret');
	});

	test('keeps the stored password when the update sends null', () => {
		const stored = buildStoredConfig({ ...input, registryAuth: { enabled: true, server: 'ghcr.io', username: 'octocat', password: 's3cret' } }, []);
		const updated = buildStoredConfig(
			{ ...input, registryAuth: { enabled: true, server: 'ghcr.io', username: 'octocat', password: null } },
			[],
			undefined,
			stored.registryAuth
		);
		expect(updated.registryAuth?.password).toBe(stored.registryAuth?.password);
	});

	test('removes registryAuth when the toggle is off', () => {
		const stored = buildStoredConfig({ ...input, registryAuth: { enabled: true, server: 'ghcr.io', username: 'octocat', password: 's3cret' } }, []);
		const updated = buildStoredConfig({ ...input, registryAuth: { enabled: false } }, [], undefined, stored.registryAuth);
		expect(updated.registryAuth).toBeUndefined();
	});

	test('omits registryAuth entirely when absent (anonymous pull)', () => {
		const stored = buildStoredConfig({ ...input }, []);
		expect(stored.registryAuth).toBeUndefined();
	});
});
