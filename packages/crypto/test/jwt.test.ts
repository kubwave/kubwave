import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { signJwtHs256 } from '../src/index';

function base64url(input: Buffer | string): string {
	return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(segment: string): string {
	return Buffer.from(segment, 'base64url').toString('utf8');
}

describe('signJwtHs256', () => {
	const payload = { role: 'anon', iss: 'supabase' };
	const secret = 'super-secret-signing-key';

	test('produces a 3-segment token', () => {
		const token = signJwtHs256(payload, secret);
		expect(token.split('.')).toHaveLength(3);
	});

	test('segment 1 decodes to the HS256 header', () => {
		const [header] = signJwtHs256(payload, secret).split('.');
		expect(decode(header!)).toBe('{"alg":"HS256","typ":"JWT"}');
	});

	test('segment 2 decodes to the input payload', () => {
		const [, body] = signJwtHs256(payload, secret).split('.');
		expect(JSON.parse(decode(body!))).toEqual(payload);
	});

	test('signature verifies against an independent HMAC recompute', () => {
		const [header, body, signature] = signJwtHs256(payload, secret).split('.');
		const signingInput = `${header}.${body}`;
		const expected = base64url(createHmac('sha256', secret).update(signingInput).digest());
		expect(signature).toBe(expected);
	});

	test('detects tampering: changed payload or secret breaks the signature', () => {
		const [header, body, signature] = signJwtHs256(payload, secret).split('.');
		const signingInput = `${header}.${body}`;

		const wrongSecret = base64url(createHmac('sha256', 'different-secret').update(signingInput).digest());
		expect(signature).not.toBe(wrongSecret);

		const tamperedBody = base64url(JSON.stringify({ role: 'service_role', iss: 'supabase' }));
		const tamperedSig = base64url(createHmac('sha256', secret).update(`${header}.${tamperedBody}`).digest());
		expect(signature).not.toBe(tamperedSig);
	});

	test('is deterministic: same payload + secret → identical token', () => {
		expect(signJwtHs256(payload, secret)).toBe(signJwtHs256(payload, secret));
	});
});
