import { describe, expect, test } from 'bun:test';
import { buildAppJwtClaims, tokenIsFresh } from '~/modules/git/github-app';

describe('buildAppJwtClaims', () => {
	test('back-dates iat by 60s and keeps exp within the 10-min cap', () => {
		const now = 1_700_000_000;
		const claims = buildAppJwtClaims('123456', now);
		expect(claims.iss).toBe('123456');
		expect(claims.iat).toBe(now - 60);
		expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60);
		expect(claims.exp).toBeGreaterThan(now);
	});
});

describe('tokenIsFresh', () => {
	const now = 1_700_000_000_000;

	test('fresh while more than the skew window remains', () => {
		expect(tokenIsFresh(now + 6 * 60_000, now)).toBe(true);
	});

	test('stale once inside the skew window or already expired', () => {
		expect(tokenIsFresh(now + 4 * 60_000, now)).toBe(false);
		expect(tokenIsFresh(now - 1, now)).toBe(false);
	});
});
