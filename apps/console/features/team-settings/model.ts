import type { CreateSshKeyDto, TeamMemberDto } from '@kubwave/api-client';

export type TeamSettingsTab = 'general' | 'members' | 'ssh-keys' | 'github' | 'gitea';
export type GitProvider = 'github' | 'gitea';

// Query params the backend's Git callbacks (and GitHub's install redirect) land on /team/settings with.
export type TeamSettingsQuery = { tab?: string; installationId?: string; gitGrant?: string; gitError?: string };

export type GitCallback = { kind: 'claim'; grant: string } | { kind: 'reconnect' } | { kind: 'failed' };

export function initialTab({ tab, installationId, gitGrant, gitError }: TeamSettingsQuery): TeamSettingsTab {
	if (tab === 'members' || tab === 'ssh-keys') return tab;
	if (tab === 'github' || installationId) return 'github';
	if (tab === 'gitea' || gitGrant || gitError) return 'gitea';
	return 'general';
}

export function tabHref(tab: TeamSettingsTab): string {
	return tab === 'general' ? '/team/settings' : `/team/settings?tab=${tab}`;
}

// A bare installation_id comes from an older GitHub App without OAuth-on-install; the backend refuses to bind it.
export function gitCallback(provider: GitProvider, { installationId, gitGrant, gitError }: TeamSettingsQuery): GitCallback | null {
	if (gitGrant) return { kind: 'claim', grant: gitGrant };
	if (gitError) return { kind: 'failed' };
	if (provider === 'github' && installationId) return { kind: 'reconnect' };
	return null;
}

export type MemberActions = { isSelf: boolean; lastOwner: boolean; canPromote: boolean; canDemote: boolean; canRemove: boolean };

export function memberActions(
	member: Pick<TeamMemberDto, 'userId' | 'role'>,
	viewer: { userId: string | undefined; isOwner: boolean },
	ownerCount: number
): MemberActions {
	const isSelf = member.userId === viewer.userId;
	return {
		isSelf,
		lastOwner: member.role === 'owner' && ownerCount <= 1,
		canPromote: viewer.isOwner && member.role === 'member',
		canDemote: viewer.isOwner && member.role === 'owner',
		canRemove: viewer.isOwner && !isSelf
	};
}

export type SshKeyDraft = { mode: 'generate' | 'upload'; name: string; privateKey: string };

export function sshKeyInput({ mode, name, privateKey }: SshKeyDraft): CreateSshKeyDto {
	return mode === 'generate' ? { mode, name: name.trim() } : { mode, name: name.trim(), privateKey: privateKey.trim() };
}
