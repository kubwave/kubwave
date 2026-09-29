import { afterEach, describe, expect, test } from 'bun:test';
import { uuid } from '../lib/uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const randomUUID = crypto.randomUUID;

afterEach(() => {
	crypto.randomUUID = randomUUID;
});

describe('uuid', () => {
	test('returns a v4 UUID', () => {
		expect(uuid()).toMatch(V4);
	});

	test('still returns a v4 UUID without randomUUID (plain-http consoles)', () => {
		crypto.randomUUID = undefined as never;
		const ids = new Set(Array.from({ length: 50 }, uuid));
		expect(ids.size).toBe(50);
		for (const id of ids) expect(id).toMatch(V4);
	});
});
