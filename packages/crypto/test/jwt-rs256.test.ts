import { describe, expect, test } from 'bun:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { signJwtRs256 } from '../src/index';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function decode(segment: string): string {
	return Buffer.from(segment, 'base64url').toString('utf8');
}

describe('signJwtRs256', () => {
	const payload = { iat: 1_700_000_000, exp: 1_700_000_540, iss: '123456' };

	test('produces a 3-segment token with an RS256 header', () => {
		const [header, body, signature] = signJwtRs256(payload, privatePem).split('.');
		expect(decode(header!)).toBe('{"alg":"RS256","typ":"JWT"}');
		expect(JSON.parse(decode(body!))).toEqual(payload);
		expect(signature).toBeTruthy();
	});

	test('signature verifies against the RSA public key', () => {
		const [header, body, signature] = signJwtRs256(payload, privatePem).split('.');
		const ok = createVerify('RSA-SHA256').update(`${header}.${body}`).verify(publicKey, Buffer.from(signature!, 'base64url'));
		expect(ok).toBe(true);
	});

	test('a tampered payload fails verification', () => {
		const [header, , signature] = signJwtRs256(payload, privatePem).split('.');
		const forgedBody = Buffer.from(JSON.stringify({ ...payload, iss: '999999' })).toString('base64url');
		const ok = createVerify('RSA-SHA256').update(`${header}.${forgedBody}`).verify(publicKey, Buffer.from(signature!, 'base64url'));
		expect(ok).toBe(false);
	});
});
