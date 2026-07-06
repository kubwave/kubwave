import { afterEach, describe, expect, test } from 'bun:test';
import { exchangeOAuthCode, listUserInstallationIds, mapRepoPage } from '~/modules/git/github-api';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string) => { status?: number; json?: unknown; text?: string }) {
	globalThis.fetch = (async (input: string | URL) => {
		const { status = 200, json, text } = handler(String(input));
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => json,
			text: async () => text ?? ''
		} as Response;
	}) as typeof fetch;
}

describe('listUserInstallationIds', () => {
	test('collects installation ids (number or string) into a string set', async () => {
		stubFetch(() => ({ json: { installations: [{ id: 42 }, { id: '7' }, { name: 'no-id' }] } }));
		const ids = await listUserInstallationIds('user-token');
		expect(ids.has('42')).toBe(true);
		expect(ids.has('7')).toBe(true);
		expect(ids.size).toBe(2);
	});

	test('a not-owned installation id is absent — the ownership check will reject it', async () => {
		stubFetch(() => ({ json: { installations: [{ id: 100 }] } }));
		const ids = await listUserInstallationIds('user-token');
		expect(ids.has('999')).toBe(false);
	});

	test('throws on a GitHub error response', () => {
		stubFetch(() => ({ status: 401, text: 'bad creds' }));
		expect(listUserInstallationIds('user-token')).rejects.toThrow();
	});
});

describe('exchangeOAuthCode', () => {
	test('returns the access token on success', async () => {
		stubFetch(() => ({ json: { access_token: 'ghu_abc' } }));
		expect(await exchangeOAuthCode('cid', 'secret', 'code')).toBe('ghu_abc');
	});

	test('throws when GitHub returns an error instead of a token', () => {
		stubFetch(() => ({ json: { error: 'bad_verification_code' } }));
		expect(exchangeOAuthCode('cid', 'secret', 'code')).rejects.toThrow();
	});
});

describe('mapRepoPage', () => {
	test('maps full_name/default_branch/private and defaults a missing branch to main', () => {
		expect(
			mapRepoPage([
				{ full_name: 'acme/api', default_branch: 'develop', private: true },
				{ full_name: 'acme/web', private: false }
			])
		).toEqual([
			{ fullName: 'acme/api', defaultBranch: 'develop', isPrivate: true },
			{ fullName: 'acme/web', defaultBranch: 'main', isPrivate: false }
		]);
	});

	test('treats a missing private flag as private (safe default)', () => {
		expect(mapRepoPage([{ full_name: 'acme/x' }])[0]!.isPrivate).toBe(true);
	});

	test('skips malformed items and non-array input', () => {
		expect(mapRepoPage([{ id: 1 }, { full_name: '' }, 'nope'])).toEqual([]);
		expect(mapRepoPage(null)).toEqual([]);
		expect(mapRepoPage(undefined)).toEqual([]);
	});
});
