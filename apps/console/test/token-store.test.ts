import { afterEach, describe, expect, test } from 'bun:test';
import { getAccessToken, onSessionLost, refreshAccessToken, setAccessToken } from '../lib/auth/token-store';

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
		}) as unknown as typeof fetch;

		await expect(refreshAccessToken()).resolves.toBe('fresh-token');
		expect(getAccessToken()).toBe('fresh-token');
		expect(calls).toEqual([['/api/auth/refresh', { method: 'POST', credentials: 'include' }]]);
	});

	test('reports a lost session only when the API rejects the refresh cookie', async () => {
		let lost = 0;
		const unsubscribe = onSessionLost(() => lost++);
		setAccessToken('stale');
		globalThis.fetch = (async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
		await refreshAccessToken();
		globalThis.fetch = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		await refreshAccessToken();
		expect(lost).toBe(0);
		globalThis.fetch = (async () => ({ ok: false, status: 401 }) as Response) as unknown as typeof fetch;
		await expect(refreshAccessToken()).resolves.toBeNull();
		expect(lost).toBe(1);
		unsubscribe();
		await refreshAccessToken();
		expect(lost).toBe(1);
	});

	test('shares one in-flight refresh between concurrent callers', async () => {
		let calls = 0;
		let respond: (res: Response) => void = () => {};
		globalThis.fetch = (() => {
			calls++;
			return new Promise<Response>(resolve => (respond = resolve));
		}) as unknown as typeof fetch;

		const first = refreshAccessToken();
		const second = refreshAccessToken();
		respond({ ok: true, json: async () => ({ accessToken: 'shared-token' }) } as Response);

		expect(await Promise.all([first, second])).toEqual(['shared-token', 'shared-token']);
		expect(calls).toBe(1);
	});

	test('starts a new refresh once the previous one settled', async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return { ok: true, json: async () => ({ accessToken: `token-${calls}` }) } as Response;
		}) as unknown as typeof fetch;

		await refreshAccessToken();
		await expect(refreshAccessToken()).resolves.toBe('token-2');
	});

	test('clears the token when refresh is rejected', async () => {
		setAccessToken('stale-token');
		globalThis.fetch = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;

		await expect(refreshAccessToken()).resolves.toBeNull();
		expect(getAccessToken()).toBeNull();
	});

	test('clears the token when refresh returns malformed JSON', async () => {
		setAccessToken('stale-token');
		globalThis.fetch = (async () =>
			({
				ok: true,
				json: async () => ({ accessToken: 123 })
			}) as Response) as unknown as typeof fetch;

		await expect(refreshAccessToken()).resolves.toBeNull();
		expect(getAccessToken()).toBeNull();
	});

	test('clears the token when refresh throws', async () => {
		setAccessToken('stale-token');
		globalThis.fetch = (async () => {
			throw new Error('network_down');
		}) as unknown as typeof fetch;

		await expect(refreshAccessToken()).resolves.toBeNull();
		expect(getAccessToken()).toBeNull();
	});
});
