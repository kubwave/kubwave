import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret } from '@kubwave/crypto';
import { dockerImageConfigSchema } from '~/modules/services/services.dto';
import { resolveBasicAuth } from '~/modules/services/services.config';

process.env.SECRETS_KEY = randomBytes(32).toString('base64url');

function parseBasicAuth(basicAuth: unknown) {
	const result = dockerImageConfigSchema.safeParse({
		image: ' nginx ',
		tag: '1',
		containerPort: 80,
		env: [],
		domains: [],
		volumes: [],
		basicAuth
	});
	return result;
}

describe('basicAuthInputSchema publicPaths', () => {
	test('accepts exact paths and trailing wildcards, keeping the raw entries', () => {
		const result = parseBasicAuth({ enabled: true, username: 'u', password: 'p', publicPaths: ['/health', '/api/*'] });
		expect(result.success).toBe(true);
		expect(result.success && result.data.basicAuth?.publicPaths).toEqual(['/health', '/api/*']);
	});

	test('rejects mid-path wildcards, relative paths, traversal, and the full wildcard', () => {
		for (const path of ['/api/*/v2', 'health', '/../etc', '/*', '/a*b']) {
			const result = parseBasicAuth({ enabled: true, username: 'u', password: 'p', publicPaths: [path] });
			expect(result.success).toBe(false);
		}
	});

	test('rejects entries whose derived path is "/" (e.g. "//*") — catch-all would disable auth', () => {
		for (const path of ['/', '//*', '/*', '/.*']) {
			const result = parseBasicAuth({ enabled: true, username: 'u', password: 'p', publicPaths: [path] });
			expect(result.success).toBe(false);
		}
		// "//*" passes the shape checks and must die on the derived-path guard, not earlier.
		const doubleSlash = parseBasicAuth({ enabled: true, username: 'u', password: 'p', publicPaths: ['//*'] });
		expect(doubleSlash.success).toBe(false);
		expect(!doubleSlash.success && doubleSlash.error.issues[0]?.message).toContain('makes every route public');
	});

	test('rejects duplicate entries and paths while basic auth is disabled', () => {
		const dupes = parseBasicAuth({ enabled: true, username: 'u', password: 'p', publicPaths: ['/x', '/x'] });
		expect(dupes.success).toBe(false);

		const disabled = parseBasicAuth({ enabled: false, publicPaths: ['/x'] });
		expect(disabled.success).toBe(false);
		expect(!disabled.success && disabled.error.issues[0]?.path).toEqual(['basicAuth', 'publicPaths']);
	});
});

describe('resolveBasicAuth publicPaths', () => {
	test('stores deduped public paths with an encrypted password', () => {
		const stored = resolveBasicAuth({ enabled: true, username: 'u', password: 'p', publicPaths: ['/api/*', '/health', '/api/*'] }, undefined);
		expect(stored?.username).toBe('u');
		expect(stored?.publicPaths).toEqual(['/api/*', '/health']);
		expect(decryptSecret(stored!.password)).toBe('p');
	});

	test('returns undefined when disabled and omits publicPaths when empty', () => {
		expect(resolveBasicAuth({ enabled: false }, undefined)).toBeUndefined();
		const stored = resolveBasicAuth({ enabled: true, username: 'u', password: 'p' }, undefined);
		expect(stored).toEqual({ username: 'u', password: stored!.password });
	});
});
