import { describe, expect, test } from 'bun:test';
import { getStatusBody, getStatusCode, isNotFoundError } from '../src/lib/k8s-errors.js';

describe('k8s error helpers', () => {
	test('reads v1 client status codes', () => {
		expect(getStatusCode({ code: 403 })).toBe(403);
	});

	test('reads legacy response status codes', () => {
		expect(getStatusCode({ response: { statusCode: 404 } })).toBe(404);
		expect(isNotFoundError({ response: { statusCode: 404 } })).toBe(true);
	});

	test('reads response bodies', () => {
		const body = { code: 409, message: 'already exists' };
		expect(getStatusCode({ response: { body } })).toBe(409);
		expect(getStatusBody({ response: { body } })).toBe(body);
	});

	test('parses string JSON bodies', () => {
		expect(getStatusCode({ body: '{"code":422}' })).toBe(422);
	});

	test('handles non-JSON string bodies gracefully', () => {
		expect(getStatusCode({ body: 'not json' })).toBeUndefined();
	});

	test('handles JSON parse failure in body gracefully', () => {
		expect(getStatusCode({ body: '{invalid}' })).toBeUndefined();
	});
});
