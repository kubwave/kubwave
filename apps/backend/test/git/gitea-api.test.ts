import { afterEach, describe, expect, test } from 'bun:test';
import {
	buildAuthorizeUrl,
	exchangeOAuthCode,
	giteaCallbackUrl,
	giteaCloneUrl,
	giteaWebhookUrl,
	getAuthenticatedUser,
	listUserRepos,
	mapGiteaRepoPage,
	normalizeInstanceUrl,
	refreshAccessToken
} from '~/modules/git/gitea-api';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; json?: unknown; text?: string }) {
	globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
		const { status = 200, json, text } = handler(String(input), init);
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => json,
			text: async () => text ?? ''
		} as Response;
	}) as typeof fetch;
}

describe('normalizeInstanceUrl', () => {
	test('strips a trailing slash and keeps http(s) origin', () => {
		expect(normalizeInstanceUrl('https://gitea.example/')).toBe('https://gitea.example');
		expect(normalizeInstanceUrl('http://gitea.internal:3000')).toBe('http://gitea.internal:3000');
	});

	test('keeps a ROOT_URL subpath', () => {
		expect(normalizeInstanceUrl('https://git.example.com/gitea/')).toBe('https://git.example.com/gitea');
	});

	test('rejects credentials, empty hosts, and non-http schemes', () => {
		expect(() => normalizeInstanceUrl('https://user:pass@gitea.example')).toThrow();
		expect(() => normalizeInstanceUrl('javascript:alert(1)')).toThrow();
		expect(() => normalizeInstanceUrl('ftp://gitea.example')).toThrow();
		expect(() => normalizeInstanceUrl('not a url')).toThrow();
	});
});

describe('gitea URL helpers', () => {
	test('callback and webhook hang off the kubwave app base, clone hangs off the instance', () => {
		expect(giteaCallbackUrl('https://console.example.com/')).toBe('https://console.example.com/api/git/gitea/callback');
		expect(giteaWebhookUrl('https://console.example.com')).toBe('https://console.example.com/api/git/gitea/webhook');
		expect(giteaCloneUrl('https://gitea.example', 'acme/api')).toBe('https://gitea.example/acme/api.git');
	});

	test('authorize URL carries client id, redirect, state, and repo scopes', () => {
		const url = buildAuthorizeUrl('https://gitea.example', 'cid', 'https://console.example.com/api/git/gitea/callback', 'signed-state');
		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe('https://gitea.example/login/oauth/authorize');
		expect(parsed.searchParams.get('client_id')).toBe('cid');
		expect(parsed.searchParams.get('redirect_uri')).toBe('https://console.example.com/api/git/gitea/callback');
		expect(parsed.searchParams.get('response_type')).toBe('code');
		expect(parsed.searchParams.get('state')).toBe('signed-state');
		expect(parsed.searchParams.get('scope')).toContain('read:repository');
		expect(parsed.searchParams.get('scope')).toContain('write:repository');
	});
});

describe('mapGiteaRepoPage', () => {
	test('maps full_name/default_branch/private and defaults a missing branch to main', () => {
		expect(
			mapGiteaRepoPage([
				{ full_name: 'acme/api', default_branch: 'develop', private: true },
				{ full_name: 'acme/web', private: false }
			])
		).toEqual([
			{ fullName: 'acme/api', defaultBranch: 'develop', isPrivate: true },
			{ fullName: 'acme/web', defaultBranch: 'main', isPrivate: false }
		]);
	});

	test('skips malformed items and non-array input', () => {
		expect(mapGiteaRepoPage([{ id: 1 }, { full_name: '' }, 'nope'])).toEqual([]);
		expect(mapGiteaRepoPage(null)).toEqual([]);
	});
});

describe('exchangeOAuthCode', () => {
	test('returns access and refresh tokens on success', async () => {
		stubFetch(() => ({ json: { access_token: 'tok', refresh_token: 'ref', expires_in: 3600 } }));
		expect(await exchangeOAuthCode('https://gitea.example', 'cid', 'secret', 'code', 'https://app/callback')).toEqual({
			accessToken: 'tok',
			refreshToken: 'ref',
			expiresIn: 3600
		});
	});

	test('throws when Gitea returns an error instead of a token', async () => {
		stubFetch(() => ({ json: { error: 'bad_verification_code' } }));
		await expect(exchangeOAuthCode('https://gitea.example', 'cid', 'secret', 'code', 'https://app/callback')).rejects.toThrow();
	});
});

describe('refreshAccessToken', () => {
	test('exchanges a refresh token for a new access token', async () => {
		stubFetch(() => ({ json: { access_token: 'tok2', refresh_token: 'ref2', expires_in: 1200 } }));
		expect(await refreshAccessToken('https://gitea.example', 'cid', 'secret', 'ref')).toEqual({
			accessToken: 'tok2',
			refreshToken: 'ref2',
			expiresIn: 1200
		});
	});
});

describe('getAuthenticatedUser', () => {
	test('prefers login, then username, and stringifies the numeric id', async () => {
		stubFetch(() => ({ json: { id: 7, login: 'kintex', username: 'other' } }));
		expect(await getAuthenticatedUser('https://gitea.example', 'tok')).toEqual({ id: '7', login: 'kintex' });
	});
});

describe('listUserRepos', () => {
	test('paginates until a short page', async () => {
		const full = Array.from({ length: 50 }, (_, i) => ({ full_name: `acme/r${i}`, private: true }));
		const short = [{ full_name: 'acme/last', private: false, default_branch: 'main' }];
		let calls = 0;
		stubFetch(url => {
			calls++;
			expect(url).toContain('/api/v1/user/repos');
			return { json: calls === 1 ? full : short };
		});
		const repos = await listUserRepos('https://gitea.example', 'tok');
		expect(calls).toBe(2);
		expect(repos).toHaveLength(51);
		expect(repos[50]).toEqual({ fullName: 'acme/last', defaultBranch: 'main', isPrivate: false });
	});
});
