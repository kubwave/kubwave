import type { McpAccessDto, McpAccessInputDto } from '@kubwave/api-client';
import { formatDateTime, formatRelative } from '@/lib/format';
import { MCP_EXPIRY_DAYS, MCP_SCOPES, type McpScope } from '@/lib/mcp';

export type AccessStatus = 'active' | 'expired' | 'revoked';

export function accessStatus(entry: Pick<McpAccessDto, 'revokedAt' | 'expiresAt'>, now = new Date()): AccessStatus {
	if (entry.revokedAt) return 'revoked';
	return new Date(entry.expiresAt) <= now ? 'expired' : 'active';
}

export function teamLabel(teamId: string | null, teams: readonly { id: string; name: string }[]): string {
	if (!teamId) return 'All teams';
	return teams.find(team => team.id === teamId)?.name ?? 'One team';
}

export function accessSummary(
	entry: Pick<McpAccessDto, 'teamId' | 'projectIds' | 'createdAt' | 'expiresAt' | 'revokedAt'>,
	teams: readonly { id: string; name: string }[],
	now = new Date()
): string {
	const count = entry.projectIds.length;
	const status = accessStatus(entry, now);
	const end =
		status === 'revoked'
			? `revoked ${formatRelative(entry.revokedAt)}`
			: `${status === 'expired' ? 'expired' : 'expires'} ${formatDateTime(entry.expiresAt)}`;
	return [teamLabel(entry.teamId, teams), count && `${count} project${count === 1 ? '' : 's'}`, `created ${formatRelative(entry.createdAt)}`, end]
		.filter(Boolean)
		.join(' · ');
}

export type McpSnippet = { id: 'claude' | 'json' | 'stdio'; label: string; value: string; wrap: boolean };

export function mcpSnippets(endpoint: string, token: string): McpSnippet[] {
	const config = { mcpServers: { kubwave: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } };
	return [
		{
			id: 'claude',
			label: 'Claude Code',
			value: `claude mcp add --transport http kubwave ${endpoint} --header "Authorization: Bearer ${token}"`,
			wrap: true
		},
		{ id: 'json', label: 'JSON config', value: JSON.stringify(config, null, 2), wrap: false },
		{ id: 'stdio', label: 'stdio (kubwave mcp)', value: `KUBWAVE_URL=${new URL(endpoint).origin} KUBWAVE_MCP_TOKEN=${token} kubwave mcp`, wrap: true }
	];
}

export type TokenDraft = {
	name: string;
	scopes: McpScope[];
	teamId: string;
	projectIds: string[];
	expiresInDays: (typeof MCP_EXPIRY_DAYS)[number];
};

// Project scoping only applies within one team; 'all' is the select's sentinel for "every team".
export function tokenInput(draft: TokenDraft): McpAccessInputDto {
	const allTeams = draft.teamId === 'all';
	return {
		name: draft.name.trim(),
		scopes: MCP_SCOPES.map(scope => scope.value).filter(scope => draft.scopes.includes(scope)),
		teamId: allTeams ? undefined : draft.teamId,
		projectIds: allTeams ? [] : draft.projectIds,
		expiresInDays: Number(draft.expiresInDays)
	};
}
