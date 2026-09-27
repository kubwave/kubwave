import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const MCP_SCOPES = ['read', 'write', 'deploy', 'delete', 'team:manage'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const mcpScopeSchema = z.enum(MCP_SCOPES);
export const accessInputSchema = z.object({
	name: z.string().trim().min(1).max(100),
	scopes: z.array(mcpScopeSchema).min(1).max(MCP_SCOPES.length),
	teamId: z.string().uuid().optional(),
	projectIds: z.array(z.string().uuid()).max(100).default([]),
	expiresInDays: z.number().int().min(1).max(365).default(30)
});
export type AccessInput = z.infer<typeof accessInputSchema>;

export function validRedirectUri(value: string): boolean {
	try {
		const url = new URL(value);
		const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
		return (
			!url.username && !url.password && !url.hash && !value.includes('*') && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
		);
	} catch {
		return false;
	}
}

export const registerClientSchema = z.object({
	client_name: z.string().trim().min(1).max(100),
	redirect_uris: z.array(z.string().max(2048).refine(validRedirectUri, 'Invalid redirect URI')).min(1).max(10),
	grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
	response_types: z.array(z.literal('code')).optional(),
	token_endpoint_auth_method: z.literal('none').default('none')
});

export const authorizationSchema = z.object({
	client_id: z.string().uuid(),
	redirect_uri: z.string().max(2048),
	response_type: z.literal('code'),
	code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	code_challenge_method: z.literal('S256'),
	resource: z.string().url().max(2048),
	scope: z.string().max(200).default('read'),
	state: z.string().max(1024).optional()
});
export type AuthorizationInput = z.infer<typeof authorizationSchema>;
export const consentSchema = authorizationSchema.extend({
	approve: z.boolean(),
	teamId: z.string().uuid().optional(),
	projectIds: z.array(z.string().uuid()).max(100).default([]),
	expiresInDays: z.number().int().min(1).max(365).default(30)
});

export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
	z.object({
		grant_type: z.literal('authorization_code'),
		client_id: z.string().uuid(),
		code: z.string().min(1).max(256),
		redirect_uri: z.string().max(2048),
		code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
		resource: z.string().url()
	}),
	z.object({
		grant_type: z.literal('refresh_token'),
		client_id: z.string().uuid(),
		refresh_token: z.string().min(1).max(256),
		resource: z.string().url(),
		scope: z.string().max(200).optional()
	})
]);
export const revokeSchema = z.object({ token: z.string().min(1).max(256), client_id: z.string().uuid(), token_type_hint: z.string().optional() });

export function tokenHash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
export function newMcpToken(): string {
	return `kwm_${randomBytes(32).toString('base64url')}`;
}
export function pkceChallenge(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}
export function requestedScopes(value: string): McpScope[] {
	return z
		.array(mcpScopeSchema)
		.min(1)
		.max(MCP_SCOPES.length)
		.parse([...new Set(value.split(' ').filter(Boolean))]);
}
