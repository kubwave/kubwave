import { afterEach, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

const TOKEN_HEADER = 'x-kubwave-access-token';
const originalFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = originalFetch));

// The API as the proxy sees it: a refresh endpoint and the setup status.
function stubApi({ session }: { session: boolean }) {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith('/api/setup/status')) return Response.json({ initialized: true, registryConfigured: true });
		if (!session) return new Response('{}', { status: 401 });
		const headers = new Headers({ 'content-type': 'application/json' });
		headers.append('set-cookie', 'refresh_token=rotated; HttpOnly; Path=/');
		return new Response(JSON.stringify({ accessToken: 'server-token' }), { headers });
	}) as unknown as typeof fetch;
}

const request = (path: string, headers: Record<string, string> = {}) =>
	new NextRequest(`http://console.test${path}`, { headers: { host: 'console.test', cookie: 'refresh_token=current', ...headers } });

// Next forwards only the request headers listed in x-middleware-override-headers.
const forwardedToken = (response: Response) =>
	response.headers.get('x-middleware-override-headers')?.split(',').includes(TOKEN_HEADER)
		? response.headers.get(`x-middleware-request-${TOKEN_HEADER}`)
		: null;

describe('proxy', () => {
	test('a page load with a session hands the token to server rendering and relays the rotated cookie', async () => {
		stubApi({ session: true });
		const response = await proxy(request('/'));
		expect(forwardedToken(response)).toBe('server-token');
		expect(response.headers.get('set-cookie')).toContain('refresh_token=rotated');
	});

	test('never forwards a token the client sent itself', async () => {
		stubApi({ session: false });
		const forged = { [TOKEN_HEADER]: 'forged' };
		expect(forwardedToken(await proxy(request('/team/settings', { ...forged, rsc: '1' })))).toBeNull();
		expect(forwardedToken(await proxy(request('/api/teams', forged)))).toBeNull();
		expect(forwardedToken(await proxy(request('/auth/login', forged)))).toBeNull();
	});

	test('client navigations skip the refresh, so parallel requests cannot race the cookie rotation', async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return new Response('{}', { status: 500 });
		}) as unknown as typeof fetch;
		await proxy(request('/team/settings', { rsc: '1' }));
		await proxy(request('/team/settings', { 'next-router-prefetch': '1' }));
		expect(calls).toBe(0);
	});

	test('a signed-out page load redirects to login and keeps the target', async () => {
		stubApi({ session: false });
		const response = await proxy(request('/team/settings?tab=members'));
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('http://console.test/auth/login?redirect=%2Fteam%2Fsettings%3Ftab%3Dmembers');
		expect(forwardedToken(response)).toBeNull();
	});
});
