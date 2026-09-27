import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, mcpClients, mcpCredentials, mcpGrants, projects, teamMembers } from '@kubwave/db';
import { ApiError } from '../../shared/errors/api-error.js';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import {
	newMcpToken,
	pkceChallenge,
	requestedScopes,
	tokenHash,
	type AccessInput,
	type AuthorizationInput,
	type consentSchema,
	type registerClientSchema,
	type tokenRequestSchema
} from './mcp.schemas.js';
import type { z } from 'zod';

export type McpGrant = typeof mcpGrants.$inferSelect;
export type McpPrincipal = McpGrant;

export function grantView(grant: McpGrant) {
	return {
		id: grant.id,
		name: grant.name,
		kind: grant.clientId ? 'oauth' : 'personal',
		scopes: grant.scopes,
		teamId: grant.teamId,
		projectIds: grant.projectIds,
		expiresAt: grant.expiresAt.toISOString(),
		revokedAt: grant.revokedAt?.toISOString() ?? null,
		createdAt: grant.createdAt.toISOString()
	};
}

@Injectable()
export class McpAuthService {
	constructor(private readonly config: BackendConfigService) {}

	get issuer(): string {
		return this.config.api.appBaseUrl.replace(/\/$/, '');
	}
	get resource(): string {
		return `${this.issuer}/api/mcp`;
	}

	async listAccess(userId: string) {
		return (await db.select().from(mcpGrants).where(eq(mcpGrants.userId, userId)).orderBy(desc(mcpGrants.createdAt))).map(grantView);
	}

	async createAccess(userId: string, input: AccessInput) {
		await this.validateAccess(userId, input);
		const token = newMcpToken();
		const grant = await db.transaction(async tx => {
			const [created] = await tx.insert(mcpGrants).values(this.grantValues(userId, input)).returning();
			if (!created) throw new Error('Failed to create MCP access');
			await tx.insert(mcpCredentials).values({ hash: tokenHash(token), grantId: created.id, kind: 'personal', expiresAt: created.expiresAt });
			return created;
		});
		return { token, access: grantView(grant), endpoint: this.resource };
	}

	async revokeAccess(userId: string, id: string): Promise<void> {
		const rows = await db
			.update(mcpGrants)
			.set({ revokedAt: new Date() })
			.where(and(eq(mcpGrants.id, id), eq(mcpGrants.userId, userId)))
			.returning({ id: mcpGrants.id });
		if (!rows.length) throw new ApiError(404, 'mcp_access_not_found');
	}

	async authenticate(token: string | undefined): Promise<McpPrincipal> {
		if (!token?.startsWith('kwm_') || token.length > 256) throw new ApiError(401, 'unauthorized');
		const [row] = await db
			.select({ grant: mcpGrants, credential: mcpCredentials })
			.from(mcpCredentials)
			.innerJoin(mcpGrants, eq(mcpGrants.id, mcpCredentials.grantId))
			.where(and(eq(mcpCredentials.hash, tokenHash(token)), inArray(mcpCredentials.kind, ['personal', 'access'])))
			.limit(1);
		if (!row || row.credential.consumedAt || row.credential.expiresAt <= new Date() || !this.active(row.grant)) {
			throw new ApiError(401, 'unauthorized');
		}
		return { ...row.grant, scopes: row.grant.scopes.filter(scope => !row.credential.scopes || row.credential.scopes.includes(scope)) };
	}

	async registerClient(input: z.infer<typeof registerClientSchema>) {
		const id = randomUUID();
		await db.insert(mcpClients).values({ id, name: input.client_name, redirectUris: [...new Set(input.redirect_uris)] });
		return {
			client_id: id,
			client_name: input.client_name,
			redirect_uris: input.redirect_uris,
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		};
	}

	async authorizationRequest(input: AuthorizationInput) {
		const [client] = await db.select().from(mcpClients).where(eq(mcpClients.id, input.client_id)).limit(1);
		if (!client || !client.redirectUris.includes(input.redirect_uri)) throw new ApiError(400, 'invalid_client');
		if (input.resource !== this.resource) throw new ApiError(400, 'invalid_target');
		let scopes: string[];
		try {
			scopes = requestedScopes(input.scope);
		} catch {
			throw new ApiError(400, 'invalid_scope');
		}
		return { clientName: client.name, redirectUri: input.redirect_uri, scopes };
	}

	async consent(userId: string, input: z.infer<typeof consentSchema>) {
		const request = await this.authorizationRequest(input);
		const redirect = new URL(input.redirect_uri);
		if (input.state !== undefined) redirect.searchParams.set('state', input.state);
		redirect.searchParams.set('iss', this.issuer);
		if (!input.approve) {
			redirect.searchParams.set('error', 'access_denied');
			return { redirectUrl: redirect.toString() };
		}
		const access: AccessInput = {
			name: request.clientName,
			scopes: requestedScopes(input.scope),
			teamId: input.teamId,
			projectIds: input.projectIds,
			expiresInDays: input.expiresInDays
		};
		await this.validateAccess(userId, access);
		const code = newMcpToken();
		await db.transaction(async tx => {
			const [grant] = await tx
				.insert(mcpGrants)
				.values({ ...this.grantValues(userId, access), clientId: input.client_id })
				.returning();
			if (!grant) throw new Error('Failed to authorize MCP client');
			await tx.insert(mcpCredentials).values({
				hash: tokenHash(code),
				grantId: grant.id,
				kind: 'code',
				redirectUri: input.redirect_uri,
				codeChallenge: input.code_challenge,
				expiresAt: new Date(Date.now() + 300_000)
			});
		});
		redirect.searchParams.set('code', code);
		return { redirectUrl: redirect.toString() };
	}

	async exchange(input: z.infer<typeof tokenRequestSchema>) {
		if (input.resource !== this.resource) throw new ApiError(400, 'invalid_target');
		const presented = input.grant_type === 'authorization_code' ? input.code : input.refresh_token;
		const result = await db.transaction(async tx => {
			const [row] = await tx
				.select({ credential: mcpCredentials, grant: mcpGrants })
				.from(mcpCredentials)
				.innerJoin(mcpGrants, eq(mcpGrants.id, mcpCredentials.grantId))
				.where(eq(mcpCredentials.hash, tokenHash(presented)))
				.for('update');
			if (!row || row.grant.clientId !== input.client_id || !this.active(row.grant) || row.credential.expiresAt <= new Date()) return null;
			const { credential, grant } = row;
			if (input.grant_type === 'authorization_code') {
				if (
					credential.kind !== 'code' ||
					credential.redirectUri !== input.redirect_uri ||
					credential.codeChallenge !== pkceChallenge(input.code_verifier)
				)
					return null;
			} else if (credential.kind !== 'refresh') return null;
			if (credential.consumedAt) {
				await tx.update(mcpGrants).set({ revokedAt: new Date() }).where(eq(mcpGrants.id, grant.id));
				return null;
			}
			let accessScopes = grant.scopes;
			if (input.grant_type === 'refresh_token' && input.scope !== undefined) {
				let scopes: string[];
				try {
					scopes = requestedScopes(input.scope);
				} catch {
					return null;
				}
				if (scopes.some(scope => !grant.scopes.includes(scope))) return null;
				accessScopes = scopes;
			}
			await tx.update(mcpCredentials).set({ consumedAt: new Date() }).where(eq(mcpCredentials.hash, credential.hash));
			const access = newMcpToken();
			const refresh = newMcpToken();
			const expiresAt = new Date(Math.min(Date.now() + 900_000, grant.expiresAt.getTime()));
			await tx.insert(mcpCredentials).values([
				{ hash: tokenHash(access), grantId: grant.id, kind: 'access', scopes: accessScopes, expiresAt },
				{ hash: tokenHash(refresh), grantId: grant.id, kind: 'refresh', expiresAt: grant.expiresAt }
			]);
			return {
				access_token: access,
				refresh_token: refresh,
				token_type: 'Bearer',
				expires_in: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
				scope: accessScopes.join(' ')
			};
		});
		if (!result) throw new ApiError(400, 'invalid_grant');
		return result;
	}

	async revokeToken(token: string, clientId: string): Promise<void> {
		const [row] = await db
			.select({ grantId: mcpGrants.id })
			.from(mcpCredentials)
			.innerJoin(mcpGrants, eq(mcpGrants.id, mcpCredentials.grantId))
			.where(and(eq(mcpCredentials.hash, tokenHash(token)), eq(mcpGrants.clientId, clientId)))
			.limit(1);
		if (row) await db.update(mcpGrants).set({ revokedAt: new Date() }).where(eq(mcpGrants.id, row.grantId));
	}

	private active(grant: McpGrant): boolean {
		return !grant.revokedAt && grant.expiresAt > new Date() && grant.resource === this.resource;
	}

	private grantValues(userId: string, input: AccessInput) {
		return {
			userId,
			name: input.name,
			resource: this.resource,
			scopes: [...new Set(input.scopes)],
			teamId: input.teamId ?? null,
			projectIds: [...new Set(input.projectIds)],
			expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000)
		};
	}

	private async validateAccess(userId: string, input: AccessInput): Promise<void> {
		if (input.teamId) {
			const [member] = await db
				.select()
				.from(teamMembers)
				.where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, input.teamId)))
				.limit(1);
			if (!member) throw new ApiError(403, 'forbidden');
		}
		if (input.projectIds.length) {
			const allowed = await db
				.select({ id: projects.id, teamId: projects.teamId })
				.from(projects)
				.innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, userId)))
				.where(inArray(projects.id, input.projectIds));
			if (new Set(input.projectIds).size !== allowed.length || allowed.some(project => input.teamId && project.teamId !== input.teamId)) {
				throw new ApiError(403, 'forbidden');
			}
		}
	}
}
