import { beforeEach, describe, expect, mock, test } from 'bun:test';

type Credential = {
	hash: string;
	grantId: string;
	kind: string;
	scopes?: string[] | null;
	redirectUri?: string | null;
	codeChallenge?: string | null;
	expiresAt: Date;
	consumedAt?: Date | null;
};
type Grant = { id: string; clientId: string | null; resource: string; scopes: string[]; expiresAt: Date; revokedAt: Date | null };

const mcpCredentials = { hash: 'credentials.hash', grantId: 'credentials.grantId' };
const mcpGrants = { id: 'grants.id' };
let credentials: Map<string, Credential>;
let grants: Map<string, Grant>;

// In-memory stand-in: eq() yields [column, value] so the fake db can resolve rows by key.
mock.module('drizzle-orm', () => ({
	eq: (column: string, value: string) => [column, value],
	and: () => null,
	desc: () => null,
	inArray: () => null
}));
mock.module('@kubwave/db', () => {
	const tx = {
		select: () => {
			let key: [string, string] = ['', ''];
			const chain = {
				from: () => chain,
				innerJoin: () => chain,
				where: (condition: [string, string]) => ((key = condition), chain),
				for: async () => {
					const credential = credentials.get(key[1]);
					const grant = credential && grants.get(credential.grantId);
					return credential && grant ? [{ credential: { ...credential }, grant: { ...grant } }] : [];
				}
			};
			return chain;
		},
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => ({
				where: async ([, value]: [string, string]) => {
					const row = table === mcpGrants ? grants.get(value) : credentials.get(value);
					if (row) Object.assign(row, values);
				}
			})
		}),
		insert: () => ({
			values: async (rows: Credential[]) => {
				for (const row of rows) credentials.set(row.hash, row);
			}
		})
	};
	return {
		db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
		mcpCredentials,
		mcpGrants,
		mcpClients: {},
		projects: {},
		teamMembers: {}
	};
});

const { McpAuthService } = await import('~/modules/mcp/mcp-auth.service');
const { tokenHash } = await import('~/modules/mcp/mcp.schemas');

const resource = 'http://console.test/api/mcp';
const clientId = '00000000-0000-4000-8000-00000000000c';
const redirect = 'http://127.0.0.1:9999/cb';
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const auth = new McpAuthService({ api: { appBaseUrl: 'http://console.test/' } } as any);
const future = () => new Date(Date.now() + 3_600_000);

const codeRequest = (overrides: Record<string, string> = {}) =>
	({
		grant_type: 'authorization_code',
		client_id: clientId,
		code: 'kwm_code',
		redirect_uri: redirect,
		code_verifier: verifier,
		resource,
		...overrides
	}) as any;
const refreshRequest = (refresh_token: string, scope?: string) =>
	({ grant_type: 'refresh_token', client_id: clientId, refresh_token, resource, scope }) as any;

beforeEach(() => {
	grants = new Map([['g1', { id: 'g1', clientId, resource, scopes: ['read', 'deploy'], expiresAt: future(), revokedAt: null }]]);
	credentials = new Map([
		[
			tokenHash('kwm_code'),
			{ hash: tokenHash('kwm_code'), grantId: 'g1', kind: 'code', redirectUri: redirect, codeChallenge: challenge, expiresAt: future() }
		]
	]);
});

describe('mcp oauth exchange', () => {
	test('issues tokens for a valid code and PKCE verifier', async () => {
		const tokens = await auth.exchange(codeRequest());
		expect(tokens.scope).toBe('read deploy');
		expect(credentials.get(tokenHash('kwm_code'))?.consumedAt).toBeInstanceOf(Date);
		expect(credentials.get(tokenHash(tokens.access_token))?.kind).toBe('access');
		expect(credentials.get(tokenHash(tokens.refresh_token))?.kind).toBe('refresh');
	});

	test.each([
		['wrong verifier', { code_verifier: 'x'.repeat(43) }],
		['wrong redirect_uri', { redirect_uri: 'http://127.0.0.1:9999/other' }],
		['another client', { client_id: '00000000-0000-4000-8000-00000000000d' }],
		['unknown code', { code: 'kwm_other' }]
	])('rejects %s', async (_name, overrides) => {
		await expect(auth.exchange(codeRequest(overrides))).rejects.toMatchObject({ status: 400, code: 'invalid_grant' });
		expect(credentials.get(tokenHash('kwm_code'))?.consumedAt).toBeUndefined();
	});

	test('rejects a mismatched resource', async () => {
		await expect(auth.exchange(codeRequest({ resource: 'http://evil.test/api/mcp' }))).rejects.toMatchObject({ code: 'invalid_target' });
	});

	test('rejects expired codes and revoked grants', async () => {
		credentials.get(tokenHash('kwm_code'))!.expiresAt = new Date(Date.now() - 1);
		await expect(auth.exchange(codeRequest())).rejects.toMatchObject({ code: 'invalid_grant' });
		credentials.get(tokenHash('kwm_code'))!.expiresAt = future();
		grants.get('g1')!.revokedAt = new Date();
		await expect(auth.exchange(codeRequest())).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	test('revokes the grant when a code is replayed', async () => {
		await auth.exchange(codeRequest());
		await expect(auth.exchange(codeRequest())).rejects.toMatchObject({ code: 'invalid_grant' });
		expect(grants.get('g1')?.revokedAt).toBeInstanceOf(Date);
	});

	test('rotates refresh tokens and revokes the grant on refresh reuse', async () => {
		const first = await auth.exchange(codeRequest());
		const second = await auth.exchange(refreshRequest(first.refresh_token));
		expect(second.refresh_token).not.toBe(first.refresh_token);
		expect(grants.get('g1')?.revokedAt).toBeNull();
		await expect(auth.exchange(refreshRequest(first.refresh_token))).rejects.toMatchObject({ code: 'invalid_grant' });
		expect(grants.get('g1')?.revokedAt).toBeInstanceOf(Date);
	});

	test('narrows but never widens scopes on refresh', async () => {
		const first = await auth.exchange(codeRequest());
		const narrowed = await auth.exchange(refreshRequest(first.refresh_token, 'read'));
		expect(narrowed.scope).toBe('read');
		expect(credentials.get(tokenHash(narrowed.access_token))?.scopes).toEqual(['read']);
		await expect(auth.exchange(refreshRequest(narrowed.refresh_token, 'read write'))).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	test('does not accept an access token as a refresh token', async () => {
		const first = await auth.exchange(codeRequest());
		await expect(auth.exchange(refreshRequest(first.access_token))).rejects.toMatchObject({ code: 'invalid_grant' });
	});
});
