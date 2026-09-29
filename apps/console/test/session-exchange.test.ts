import { afterEach, describe, expect, test } from 'bun:test';
import { fetchSetupStatus, refreshSession } from '../lib/auth/session-exchange';

const originalFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = originalFetch));

function respond(status: number, body: unknown, setCookies: string[] = []) {
	const headers = new Headers();
	for (const cookie of setCookies) headers.append('set-cookie', cookie);
	return new Response(JSON.stringify(body), { status, headers });
}

describe('refreshSession', () => {
	test('without a refresh cookie, does not call the API', async () => {
		let called = false;
		globalThis.fetch = (async () => ((called = true), respond(200, {}))) as unknown as typeof fetch;
		expect(await refreshSession(undefined)).toBeNull();
		expect(called).toBe(false);
	});

	test('exchanges the cookie and keeps every rotated Set-Cookie for the browser', async () => {
		const requests: Array<[string, RequestInit | undefined]> = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			requests.push([url, init]);
			return respond(200, { accessToken: 'fresh' }, ['refresh_token=next; HttpOnly', 'active_team=t1']);
		}) as unknown as typeof fetch;

		expect(await refreshSession('old')).toEqual({ accessToken: 'fresh', setCookies: ['refresh_token=next; HttpOnly', 'active_team=t1'] });
		expect(requests[0]?.[0]).toBe('http://localhost:3001/api/auth/refresh');
		expect(new Headers(requests[0]?.[1]?.headers).get('cookie')).toBe('refresh_token=old');
	});

	test('treats a rejected or malformed refresh as signed out', async () => {
		globalThis.fetch = (async () => respond(401, { error: 'invalid_refresh_token' })) as unknown as typeof fetch;
		expect(await refreshSession('old')).toBeNull();
		globalThis.fetch = (async () => respond(200, { accessToken: 42 })) as unknown as typeof fetch;
		expect(await refreshSession('old')).toBeNull();
	});
});

describe('fetchSetupStatus', () => {
	test('reads both setup flags', async () => {
		globalThis.fetch = (async () => respond(200, { initialized: true, registryConfigured: false })) as unknown as typeof fetch;
		expect(await fetchSetupStatus()).toEqual({ initialized: true, registryConfigured: false });
	});

	test('assumes a set-up platform when the API is unreachable, so signed-in users are not sent to setup', async () => {
		globalThis.fetch = (async () => {
			throw new Error('ECONNREFUSED');
		}) as unknown as typeof fetch;
		expect(await fetchSetupStatus()).toEqual({ initialized: true, registryConfigured: true });
		globalThis.fetch = (async () => respond(503, {})) as unknown as typeof fetch;
		expect(await fetchSetupStatus()).toEqual({ initialized: true, registryConfigured: true });
	});
});
