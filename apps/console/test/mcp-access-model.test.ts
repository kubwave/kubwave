import { describe, expect, test } from 'bun:test';
import { accessStatus, accessSummary, mcpSnippets, teamLabel, tokenInput } from '../features/account/mcp-model';
import { oauthRequestFrom } from '../lib/mcp';

const now = new Date('2026-09-28T12:00:00Z');
const teams = [{ id: 't1', name: 'Acme' }];

describe('oauthRequestFrom', () => {
	test('keeps only the OAuth fields that are set, taking the first of repeated keys', () => {
		expect(oauthRequestFrom({ client_id: 'c1', redirect_uri: ['https://a/cb', 'https://b/cb'], state: '', extra: 'x' })).toEqual({
			client_id: 'c1',
			redirect_uri: 'https://a/cb'
		} as never);
	});
});

describe('accessStatus', () => {
	test('revoked wins over everything', () => {
		expect(accessStatus({ revokedAt: '2026-09-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z' }, now)).toBe('revoked');
	});

	test('past the expiry date is expired', () => {
		expect(accessStatus({ revokedAt: null, expiresAt: '2026-09-28T12:00:00Z' }, now)).toBe('expired');
	});

	test('otherwise active', () => {
		expect(accessStatus({ revokedAt: null, expiresAt: '2026-09-29T00:00:00Z' }, now)).toBe('active');
	});
});

describe('teamLabel', () => {
	test('no team means every team', () => {
		expect(teamLabel(null, teams)).toBe('All teams');
	});

	test('a known team shows its name, a team the user left stays anonymous', () => {
		expect(teamLabel('t1', teams)).toBe('Acme');
		expect(teamLabel('gone', teams)).toBe('One team');
	});
});

describe('accessSummary', () => {
	const entry = { teamId: 't1', projectIds: ['p1', 'p2'], createdAt: '2026-09-27T12:00:00Z', expiresAt: '2026-10-28T12:00:00Z', revokedAt: null };

	test('lists team, project scope and expiry', () => {
		const summary = accessSummary(entry, teams, now);
		expect(summary).toStartWith('Acme · 2 projects · created ');
		expect(summary).toContain('· expires ');
	});

	test('names the end state of inactive access', () => {
		expect(accessSummary({ ...entry, projectIds: ['p1'], revokedAt: '2026-09-28T11:00:00Z' }, teams, now)).toContain('1 project · created');
		expect(accessSummary({ ...entry, revokedAt: '2026-09-28T11:00:00Z' }, teams, now)).toContain('· revoked ');
		expect(accessSummary({ ...entry, expiresAt: '2026-09-01T00:00:00Z' }, teams, now)).toContain('· expired ');
	});
});

describe('mcpSnippets', () => {
	const [claude, json, stdio] = mcpSnippets('https://kw.example.com/api/mcp', 'kw_secret');

	test('Claude Code adds the HTTP server with the bearer header', () => {
		expect(claude?.value).toBe('claude mcp add --transport http kubwave https://kw.example.com/api/mcp --header "Authorization: Bearer kw_secret"');
	});

	test('the JSON config is a valid mcpServers entry', () => {
		expect(JSON.parse(json?.value ?? '')).toEqual({
			mcpServers: { kubwave: { type: 'http', url: 'https://kw.example.com/api/mcp', headers: { Authorization: 'Bearer kw_secret' } } }
		});
	});

	test('stdio points the CLI at the instance origin', () => {
		expect(stdio?.value).toBe('KUBWAVE_URL=https://kw.example.com KUBWAVE_MCP_TOKEN=kw_secret kubwave mcp');
	});
});

describe('tokenInput', () => {
	test('all teams sends no team and no project scope', () => {
		expect(tokenInput({ name: ' laptop ', scopes: ['deploy', 'read'], teamId: 'all', projectIds: ['p1'], expiresInDays: '30' })).toEqual({
			name: 'laptop',
			scopes: ['read', 'deploy'],
			teamId: undefined,
			projectIds: [],
			expiresInDays: 30
		});
	});

	test('a single team keeps its chosen projects', () => {
		expect(tokenInput({ name: 'ci', scopes: ['read'], teamId: 't1', projectIds: ['p1'], expiresInDays: '7' })).toEqual({
			name: 'ci',
			scopes: ['read'],
			teamId: 't1',
			projectIds: ['p1'],
			expiresInDays: 7
		});
	});
});
