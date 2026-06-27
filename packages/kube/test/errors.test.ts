import { describe, expect, test } from 'bun:test';
import { isConflict, isNotFound } from '../src/client/errors';

describe('isNotFound', () => {
	test('true for direct code 404', () => {
		expect(isNotFound({ code: 404 })).toBe(true);
	});

	test('true for statusCode 404', () => {
		expect(isNotFound({ statusCode: 404 })).toBe(true);
	});

	test('true for response.statusCode 404', () => {
		expect(isNotFound({ response: { statusCode: 404 } })).toBe(true);
	});

	test('true for response.status 404', () => {
		expect(isNotFound({ response: { status: 404 } })).toBe(true);
	});

	test('false for null', () => {
		expect(isNotFound(null)).toBe(false);
	});

	test('false for undefined', () => {
		expect(isNotFound(undefined)).toBe(false);
	});

	test('false for non-object primitives', () => {
		expect(isNotFound('404')).toBe(false);
		expect(isNotFound(404)).toBe(false);
	});

	test('false for a different code (409/500)', () => {
		expect(isNotFound({ code: 409 })).toBe(false);
		expect(isNotFound({ statusCode: 500 })).toBe(false);
		expect(isNotFound({ response: { status: 200 } })).toBe(false);
	});

	test('false for an object with no recognised fields', () => {
		expect(isNotFound({ message: 'nope' })).toBe(false);
	});
});

describe('isConflict', () => {
	test('true for direct code 409', () => {
		expect(isConflict({ code: 409 })).toBe(true);
	});

	test('true for statusCode 409', () => {
		expect(isConflict({ statusCode: 409 })).toBe(true);
	});

	test('true for response.statusCode 409', () => {
		expect(isConflict({ response: { statusCode: 409 } })).toBe(true);
	});

	test('true for response.status 409', () => {
		expect(isConflict({ response: { status: 409 } })).toBe(true);
	});

	test('false for null / undefined / primitives', () => {
		expect(isConflict(null)).toBe(false);
		expect(isConflict(undefined)).toBe(false);
		expect(isConflict('409')).toBe(false);
	});

	test('false for a different code (404)', () => {
		expect(isConflict({ code: 404 })).toBe(false);
		expect(isConflict({ response: { status: 404 } })).toBe(false);
	});
});
