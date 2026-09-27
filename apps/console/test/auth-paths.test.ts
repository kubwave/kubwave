import { describe, expect, test } from 'bun:test';
import { loginPath, safeRedirect } from '../shared/auth-paths';

describe('login redirect', () => {
	test('round-trips a path with its query', () => {
		const target = '/mcp/authorize?client_id=a&redirect_uri=http%3A%2F%2Flocalhost%2Fcb';
		const redirect = new URLSearchParams(loginPath(target).split('?')[1]).get('redirect');
		expect(safeRedirect(redirect)).toBe(target);
	});

	test('rejects off-site targets', () => {
		for (const value of ['//evil.com', '/\\evil.com', 'https://evil.com', undefined, ['/a']]) expect(safeRedirect(value)).toBe('/');
	});
});
