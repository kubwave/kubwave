import type { McpAccessInputDto, McpAuthorizationDto } from '@kubwave/api-client';
import { firstParam } from '@/lib/search-params';

const OAUTH_PARAMS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'state'] as const;

// The OAuth authorize request from the page query. The API validates every field; missing or
// unknown ones surface as an invalid request, so absent keys are simply left out.
export function oauthRequestFrom(query: Record<string, string | string[] | undefined>): McpAuthorizationDto {
	return Object.fromEntries(OAUTH_PARAMS.flatMap(key => (firstParam(query[key]) ? [[key, firstParam(query[key])]] : []))) as McpAuthorizationDto;
}

export type McpScope = McpAccessInputDto['scopes'][number];

export const MCP_SCOPES: { value: McpScope; label: string; description: string; destructive?: boolean }[] = [
	{ value: 'read', label: 'Read', description: 'View teams, projects, services, deployments, logs and metrics.' },
	{ value: 'write', label: 'Write', description: 'Create and change projects, environments and services.' },
	{ value: 'deploy', label: 'Deploy', description: 'Start and cancel deployments.' },
	{ value: 'delete', label: 'Delete', description: 'Delete projects, environments and services.', destructive: true },
	{ value: 'team:manage', label: 'Manage teams', description: 'Create teams, manage members and SSH keys.', destructive: true }
];

export const MCP_EXPIRY_DAYS = ['7', '30', '90'] as const;

export function mcpScope(value: string) {
	return MCP_SCOPES.find(scope => scope.value === value) ?? { value, label: value, description: '', destructive: false };
}
