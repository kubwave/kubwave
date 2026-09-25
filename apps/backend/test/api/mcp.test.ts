import { describe, expect, mock, test } from 'bun:test';
import type { McpPrincipal } from '~/modules/mcp/mcp-auth.service';
import { pkceChallenge, requestedScopes, validRedirectUri } from '~/modules/mcp/mcp.schemas';

mock.module('@kubwave/db', () => ({ db: {}, deployments: {}, environments: {}, mcpRequests: {}, projects: {}, services: {}, teamMembers: {} }));

const { assertGrantTarget, assertMcpScopes, redactMcpOutput } = await import('~/modules/mcp/mcp-execution');

const teamId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const principal = (overrides: Partial<McpPrincipal> = {}) => ({ scopes: ['read'], teamId: null, projectIds: [], ...overrides }) as McpPrincipal;

describe('mcp', () => {
	test('accepts only https or loopback http redirect URIs', () => {
		expect(validRedirectUri('https://client.example/cb')).toBe(true);
		expect(validRedirectUri('http://127.0.0.1:4000/cb')).toBe(true);
		expect(validRedirectUri('http://client.example/cb')).toBe(false);
		expect(validRedirectUri('https://user:pw@client.example/cb')).toBe(false);
		expect(validRedirectUri('https://client.example/cb#x')).toBe(false);
	});

	test('parses scopes and rejects unknown ones', () => {
		expect(requestedScopes('read  deploy read')).toEqual(['read', 'deploy']);
		expect(() => requestedScopes('read platform:admin')).toThrow();
		expect(() => requestedScopes('')).toThrow();
	});

	test('computes the RFC 7636 S256 challenge', () => {
		expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
	});

	test('enforces scopes and team/project restrictions', () => {
		expect(() => assertMcpScopes(principal(), ['read'])).not.toThrow();
		expect(() => assertMcpScopes(principal(), ['deploy'])).toThrow();
		expect(() => assertGrantTarget(principal({ teamId }), teamId)).not.toThrow();
		expect(() => assertGrantTarget(principal({ teamId }), projectId)).toThrow();
		expect(() => assertGrantTarget(principal({ projectIds: [projectId] }), teamId)).toThrow();
		expect(() => assertGrantTarget(principal({ projectIds: [projectId] }), teamId, projectId)).not.toThrow();
	});

	test('redacts credentials and file contents from tool output', () => {
		expect(
			redactMcpOutput({ items: [{ name: 'db', password: 'x', uri: 'postgres://x', configFiles: [{ path: '/a', content: 'secret' }] }] })
		).toEqual({
			items: [{ name: 'db', configFiles: [{ path: '/a', hasContent: true }] }]
		});
	});
});
