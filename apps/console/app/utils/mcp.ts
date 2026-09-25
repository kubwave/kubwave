import type { McpAccessInputDto } from '@kubwave/api-client';

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
