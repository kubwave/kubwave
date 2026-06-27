import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../src/index';

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

describe('encryptSecret / decryptSecret', () => {
	test('round-trips a value', () => {
		const plaintext = 'super-secret-token-123';
		expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
	});

	test('round-trips empty and unicode values', () => {
		for (const value of ['', 'pä$$wörd 🔐', 'a'.repeat(4000)]) {
			expect(decryptSecret(encryptSecret(value))).toBe(value);
		}
	});

	test('uses a fresh IV per call (same plaintext → different ciphertext)', () => {
		const a = encryptSecret('same');
		const b = encryptSecret('same');
		expect(a).not.toBe(b);
		expect(a.startsWith('v1:')).toBe(true);
	});

	test('rejects a tampered ciphertext (GCM auth tag)', () => {
		const serialized = encryptSecret('integrity');
		const parts = serialized.split(':');
		// Flip a byte in the ciphertext segment.
		const ct = Buffer.from(parts[3]!, 'base64url');
		ct[0] = ct[0]! ^ 0xff;
		parts[3] = ct.toString('base64url');
		expect(() => decryptSecret(parts.join(':'))).toThrow();
	});

	test('rejects a malformed serialized string', () => {
		expect(() => decryptSecret('not-a-secret')).toThrow('Malformed');
		expect(() => decryptSecret('v2:a:b:c')).toThrow('Malformed');
	});
});
