import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret } from '@kubwave/crypto';
import { resolveSecrets, toConfigView } from '~/modules/services/services.config';
import type { ServiceConfig } from '@kubwave/db';

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
