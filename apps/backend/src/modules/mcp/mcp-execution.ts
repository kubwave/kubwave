import { and, eq } from 'drizzle-orm';
import { db, deployments, environments, mcpRequests, projects, services, teamMembers } from '@kubwave/db';
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/server';
import { ApiError } from '../../shared/errors/api-error.js';
import type { McpPrincipal } from './mcp-auth.service.js';
import { tokenHash, type McpScope } from './mcp.schemas.js';

export type McpTarget =
	| { kind: 'team' | 'project' | 'environment' | 'service' | 'deployment'; id: string; listProjects?: boolean }
	| { kind: 'unrestricted' };
export type McpToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent: Record<string, unknown>; isError?: boolean };
export interface McpTool {
	definition: Tool;
	scopes: McpScope[];
	execute: (principal: McpPrincipal, args: Record<string, unknown>) => Promise<McpToolResult>;
}

export function assertGrantTarget(principal: McpPrincipal, teamId: string, projectId?: string): void {
	if (principal.teamId && principal.teamId !== teamId) throw new ApiError(403, 'mcp_target_not_allowed');
	if (principal.projectIds.length && (!projectId || !principal.projectIds.includes(projectId))) throw new ApiError(403, 'mcp_target_not_allowed');
}

export function assertMcpScopes(principal: McpPrincipal, scopes: McpScope[]): void {
	if (scopes.some(scope => !principal.scopes.includes(scope))) throw new ApiError(403, 'insufficient_scope');
}

export async function authorizeTarget(principal: McpPrincipal, target: McpTarget): Promise<void> {
	if (target.kind === 'unrestricted') {
		if (principal.teamId || principal.projectIds.length) throw new ApiError(403, 'mcp_target_not_allowed');
		return;
	}
	let teamId: string;
	let projectId: string | undefined;
	if (target.kind === 'team') teamId = target.id;
	else if (target.kind === 'project') {
		const [row] = await db.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, target.id)).limit(1);
		if (!row) throw new ApiError(404, 'not_found');
		teamId = row.teamId;
		projectId = target.id;
	} else {
		let environmentId = target.id;
		if (target.kind === 'service' || target.kind === 'deployment') {
			let serviceId = target.id;
			if (target.kind === 'deployment') {
				const [row] = await db.select({ serviceId: deployments.serviceId }).from(deployments).where(eq(deployments.id, target.id)).limit(1);
				if (!row) throw new ApiError(404, 'not_found');
				serviceId = row.serviceId;
			}
			const [row] = await db.select({ environmentId: services.environmentId }).from(services).where(eq(services.id, serviceId)).limit(1);
			if (!row) throw new ApiError(404, 'not_found');
			environmentId = row.environmentId;
		}
		const [row] = await db
			.select({ teamId: projects.teamId, projectId: projects.id })
			.from(environments)
			.innerJoin(projects, eq(projects.id, environments.projectId))
			.where(eq(environments.id, environmentId))
			.limit(1);
		if (!row) throw new ApiError(404, 'not_found');
		teamId = row.teamId;
		projectId = row.projectId;
	}
	const [member] = await db
		.select({ id: teamMembers.userId })
		.from(teamMembers)
		.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, principal.userId)))
		.limit(1);
	if (!member) throw new ApiError(403, 'forbidden');
	assertGrantTarget(target.kind === 'team' && target.listProjects ? { ...principal, projectIds: [] } : principal, teamId, projectId);
}

export function redactMcpOutput(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactMcpOutput);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(
				([key]) =>
					![
						'password',
						'uri',
						'externalUri',
						'privateKey',
						'privateKeyCiphertext',
						'clientSecret',
						'clientSecretCiphertext',
						'token',
						'generatedSecrets'
					].includes(key)
			)
			.map(([key, item]) => [
				key,
				key === 'configFiles' && Array.isArray(item) ? item.map(file => ({ path: file.path, hasContent: true })) : redactMcpOutput(item)
			])
	);
}

function result(value: unknown, isError = false): McpToolResult {
	const safe = redactMcpOutput(value ?? { ok: true });
	const data: Record<string, unknown> =
		safe && typeof safe === 'object' && !Array.isArray(safe) ? (safe as Record<string, unknown>) : { items: safe };
	return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, ...(isError ? { isError: true } : {}) };
}

export function mcpError(error: unknown): McpToolResult {
	if (error instanceof z.ZodError)
		return result({ error: 'invalid_input', details: error.issues.map(issue => ({ path: issue.path, message: issue.message })) }, true);
	if (error instanceof ApiError) return result({ error: error.code, status: error.status }, true);
	console.error('[mcp] tool failed', error);
	return result({ error: 'internal_error' }, true);
}

function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, item: unknown) =>
		item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item
	);
}

export function defineMcpTool<S extends z.ZodRawShape>(options: {
	name: string;
	description: string;
	schema: z.ZodObject<S>;
	scopes: McpScope[];
	readOnly?: boolean;
	targets?: (args: z.infer<z.ZodObject<S>>) => McpTarget[];
	run: (userId: string, args: z.infer<z.ZodObject<S>>, principal: McpPrincipal) => Promise<unknown> | unknown;
}): McpTool {
	const schema = options.readOnly
		? options.schema
		: options.schema.extend({ requestId: z.string().uuid().describe('Unique operation UUID. Reuse it when retrying the same request.') });
	return {
		scopes: options.scopes,
		definition: {
			name: options.name,
			description: options.description,
			inputSchema: z.toJSONSchema(schema, { io: 'input' }) as Tool['inputSchema'],
			annotations: {
				readOnlyHint: options.readOnly ?? false,
				destructiveHint: options.scopes.includes('delete'),
				idempotentHint: true,
				openWorldHint: true
			}
		},
		execute: async (principal, raw) => {
			try {
				assertMcpScopes(principal, options.scopes);
				const parsed = schema.parse(raw);
				const args = options.schema.parse(parsed);
				for (const target of options.targets?.(args) ?? []) await authorizeTarget(principal, target);
				if (options.readOnly) return result(await options.run(principal.userId, args, principal));
				const requestId = z.string().uuid().parse(raw.requestId);
				const requestHash = tokenHash(canonical({ tool: options.name, args }));
				const [inserted] = await db.insert(mcpRequests).values({ grantId: principal.id, requestId, requestHash }).onConflictDoNothing().returning();
				if (!inserted) {
					const [prior] = await db
						.select()
						.from(mcpRequests)
						.where(and(eq(mcpRequests.grantId, principal.id), eq(mcpRequests.requestId, requestId)))
						.limit(1);
					if (!prior || prior.requestHash !== requestHash) throw new ApiError(409, 'mcp_request_id_conflict');
					if (!prior.result) throw new ApiError(409, 'mcp_operation_pending_or_unknown');
					return prior.result as McpToolResult;
				}
				let response: McpToolResult;
				try {
					response = result(await options.run(principal.userId, args, principal));
				} catch (error) {
					response = mcpError(error);
				}
				await db
					.update(mcpRequests)
					.set({ result: response })
					.where(and(eq(mcpRequests.grantId, principal.id), eq(mcpRequests.requestId, requestId)));
				return response;
			} catch (error) {
				return mcpError(error);
			}
		}
	};
}
