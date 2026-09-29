import { describe, expect, test } from 'bun:test';
import { decideRoute, isDocumentRequest, isExemptPath, publicUrl, type AuthState } from '../lib/auth/route-policy';

const ready = { initialized: true, registryConfigured: true };

function state(overrides: Partial<AuthState>): AuthState {
	return { pathname: '/', fullPath: '/', signedIn: false, setup: ready, ...overrides };
}

describe('decideRoute', () => {
	test('before the first admin exists, every page except setup goes to /auth/setup', () => {
		const setup = { initialized: false, registryConfigured: false };
		expect(decideRoute(state({ pathname: '/', setup }))).toEqual({ redirect: '/auth/setup' });
		expect(decideRoute(state({ pathname: '/auth/login', setup }))).toEqual({ redirect: '/auth/setup' });
		expect(decideRoute(state({ pathname: '/auth/setup', setup }))).toEqual({ render: true });
	});

	test('once set up, a signed-out visit to /auth/setup goes to /auth/login', () => {
		expect(decideRoute(state({ pathname: '/auth/setup' }))).toEqual({ redirect: '/auth/login' });
	});

	test('signed out, public pages render', () => {
		expect(decideRoute(state({ pathname: '/auth/reset', fullPath: '/auth/reset?token=abc' }))).toEqual({ render: true });
	});

	test('signed out, a protected page goes to login and keeps the full target for the round-trip', () => {
		const fullPath = '/mcp/authorize?client_id=c&state=s';
		expect(decideRoute(state({ pathname: '/mcp/authorize', fullPath }))).toEqual({
			redirect: `/auth/login?redirect=${encodeURIComponent(fullPath)}`
		});
		expect(decideRoute(state({ pathname: '/' }))).toEqual({ redirect: '/auth/login' });
	});

	test('signed in without a registry, only /auth/setup renders', () => {
		const setup = { initialized: true, registryConfigured: false };
		expect(decideRoute(state({ signedIn: true, pathname: '/team/settings', setup }))).toEqual({ redirect: '/auth/setup' });
		expect(decideRoute(state({ signedIn: true, pathname: '/auth/setup', setup }))).toEqual({ render: true });
	});

	test('signed in, public pages bounce home and protected pages render', () => {
		expect(decideRoute(state({ signedIn: true, pathname: '/auth/login' }))).toEqual({ redirect: '/' });
		expect(decideRoute(state({ signedIn: true, pathname: '/auth/setup' }))).toEqual({ redirect: '/' });
		expect(decideRoute(state({ signedIn: true, pathname: '/admin/users' }))).toEqual({ render: true });
	});
});

describe('isExemptPath', () => {
	test('skips framework assets, the API, OAuth discovery, the health probe and static files', () => {
		for (const path of [
			'/_next/static/chunks/a.js',
			'/api/auth/refresh',
			'/.well-known/oauth-authorization-server',
			'/health',
			'/favicon.ico',
			'/logo.png'
		])
			expect(isExemptPath(path)).toBe(true);
	});

	test('still guards pages whose last segment contains a dot', () => {
		expect(isExemptPath('/team/projects/my.app')).toBe(false);
		expect(isExemptPath('/')).toBe(false);
	});
});

describe('isDocumentRequest', () => {
	test('treats a plain browser navigation as a document load', () => {
		expect(isDocumentRequest(new Headers({ accept: 'text/html' }))).toBe(true);
	});

	test('skips React Server Component fetches and router prefetches from client navigations', () => {
		expect(isDocumentRequest(new Headers({ rsc: '1' }))).toBe(false);
		expect(isDocumentRequest(new Headers({ 'next-router-prefetch': '1' }))).toBe(false);
	});
});

describe('publicUrl', () => {
	const fallback = new URL('http://localhost:3000/team/settings');

	test('uses the host and scheme the browser used, as forwarded by the ingress', () => {
		const headers = new Headers({ host: 'console.example.com', 'x-forwarded-proto': 'https' });
		expect(publicUrl('/auth/login?redirect=%2F', headers, fallback).href).toBe('https://console.example.com/auth/login?redirect=%2F');
	});

	test('takes the first proto of a forwarded chain', () => {
		const headers = new Headers({ host: 'console.example.com', 'x-forwarded-proto': 'https, http' });
		expect(publicUrl('/', headers, fallback).protocol).toBe('https:');
	});

	test('falls back to the server address without proxy headers', () => {
		expect(publicUrl('/auth/setup', new Headers(), fallback).href).toBe('http://localhost:3000/auth/setup');
	});
});
