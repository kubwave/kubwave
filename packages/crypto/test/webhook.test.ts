import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../src/index';

const secret = 'webhook-secret-123';
const body = JSON.stringify({ action: 'push', ref: 'refs/heads/main' });

function sign(payload: string, key: string): string {
	return `sha256=${createHmac('sha256', key).update(payload).digest('hex')}`;
}

describe('verifyWebhookSignature', () => {
	test('accepts a valid signature over the raw body', () => {
		expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
	});

	test('accepts a Buffer body', () => {
		expect(verifyWebhookSignature(Buffer.from(body), sign(body, secret), secret)).toBe(true);
	});

	test('rejects a wrong secret, tampered body, or wrong scheme', () => {
		expect(verifyWebhookSignature(body, sign(body, 'other-secret'), secret)).toBe(false);
		expect(verifyWebhookSignature(`${body} `, sign(body, secret), secret)).toBe(false);
		expect(verifyWebhookSignature(body, sign(body, secret).replace('sha256=', 'sha1='), secret)).toBe(false);
	});

	test('rejects missing or malformed headers', () => {
		expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
		expect(verifyWebhookSignature(body, null, secret)).toBe(false);
		expect(verifyWebhookSignature(body, 'garbage', secret)).toBe(false);
		expect(verifyWebhookSignature(body, 'sha256=', secret)).toBe(false);
	});
});
