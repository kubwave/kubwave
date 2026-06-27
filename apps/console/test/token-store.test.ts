import { afterEach, describe, expect, test } from 'bun:test';
import { getAccessToken, refreshAccessToken, setAccessToken } from '../app/utils/token-store';

const originalFetch = globalThis.fetch;

afterEach(() => {
	setAccessToken(null);
	globalThis.fetch = originalFetch;
});

describe('token store', () => {
	test('stores the in-memory access token', () => {
		expect(getAccessToken()).toBeNull();

		setAccessToken('access-token');
		expect(getAccessToken()).toBe('access-token');

		setAccessToken(null);
		expect(getAccessToken()).toBeNull();
	});

	test('refreshes the token with the HttpOnly refresh cookie', async () => {
		const calls: unknown[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push([input, init]);
			return {
				ok: true,
				json: async () => ({ accessToken: 'fresh-token' })
			} as Response;
		}) as typeof fetch;

		await expect(refreshAccessToken()).resolves.toBe('fresh-token');
		expect(getAccessToken()).toBe('fresh-token');
		expect(calls).toEqual([['/api/auth/refresh', { method: 'POST', credentials: 'include' }]]);
	});

	test('clears the token when refresh is rejected', async () => {
		setAccessToken('stale-token');
		globalThis.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;

		await expect(refreshAccessToken()).resolves.toBeNull();
		expect(getAccessToken()).toBeNull();
	});

	test('clears the token when refresh returns malformed JSON', async () => {
		setAccessToken('stale-token');
		globalThis.fetch = (async () =>
			({
				ok: true,
				json: async () => ({ accessToken: 123 })
			}) as Response) as typeof fetch;

		await expect(refreshAccessToken()).resolves.toBeNull();
		expect(getAccessToken()).toBeNull();
	});

	test('clears the token when refresh throws', async () => {
		setAccessToken('stale-token');
		globalThis.fetch = (async () => {
			throw new Error('network_down');
		}) as typeof fetch;

		await expect(refreshAccessToken()).resolves.toBeNull();
		expect(getAccessToken()).toBeNull();
	});
});
