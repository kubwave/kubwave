import { describe, expect, test } from 'bun:test';
import { addMemberError, memberErrorMessage, sshKeyCreateError, sshKeyDeleteErrorMessage } from '../features/team-settings/errors';
import { gitCallback, initialTab, memberActions, sshKeyInput, tabHref } from '../features/team-settings/model';

describe('initialTab', () => {
	test('opens the tab named in the query', () => {
		expect(initialTab({ tab: 'members' })).toBe('members');
		expect(initialTab({ tab: 'ssh-keys' })).toBe('ssh-keys');
		expect(initialTab({ tab: 'github' })).toBe('github');
		expect(initialTab({ tab: 'gitea' })).toBe('gitea');
	});

	test('falls back to general for a missing or unknown tab', () => {
		expect(initialTab({})).toBe('general');
		expect(initialTab({ tab: 'billing' })).toBe('general');
	});

	test('a GitHub App install return (installation_id) opens the GitHub tab', () => {
		expect(initialTab({ installationId: '42' })).toBe('github');
		expect(initialTab({ tab: 'gitea', installationId: '42' })).toBe('github');
	});

	test('a bare git grant or error opens the Gitea tab', () => {
		expect(initialTab({ gitGrant: 'g' })).toBe('gitea');
		expect(initialTab({ gitError: 'denied' })).toBe('gitea');
		expect(initialTab({ tab: 'github', gitGrant: 'g' })).toBe('github');
	});
});

describe('tabHref', () => {
	test('general is the bare settings URL, other tabs are shareable via ?tab=', () => {
		expect(tabHref('general')).toBe('/team/settings');
		expect(tabHref('ssh-keys')).toBe('/team/settings?tab=ssh-keys');
	});
});

describe('gitCallback', () => {
	test('nothing to do without callback params', () => {
		expect(gitCallback('github', { tab: 'github' })).toBeNull();
		expect(gitCallback('gitea', { tab: 'gitea' })).toBeNull();
	});

	test('a grant is claimed for either provider', () => {
		expect(gitCallback('github', { gitGrant: 'g1' })).toEqual({ kind: 'claim', grant: 'g1' });
		expect(gitCallback('gitea', { gitGrant: 'g2' })).toEqual({ kind: 'claim', grant: 'g2' });
	});

	test('a bare GitHub installation_id means the App must be reconnected', () => {
		expect(gitCallback('github', { installationId: '42' })).toEqual({ kind: 'reconnect' });
	});

	test('a git_error fails, also when an installation_id came along', () => {
		expect(gitCallback('github', { gitError: 'x', installationId: '42' })).toEqual({ kind: 'failed' });
		expect(gitCallback('gitea', { gitError: 'x' })).toEqual({ kind: 'failed' });
	});

	test('Gitea ignores GitHub install params', () => {
		expect(gitCallback('gitea', { installationId: '42' })).toBeNull();
	});
});

describe('memberActions', () => {
	const owner = { userId: 'me', isOwner: true };
	const member = { userId: 'me', isOwner: false };

	test('owners can promote members and remove others', () => {
		expect(memberActions({ userId: 'u2', role: 'member' }, owner, 1)).toEqual({
			isSelf: false,
			lastOwner: false,
			canPromote: true,
			canDemote: false,
			canRemove: true
		});
	});

	test('the only owner cannot be demoted', () => {
		const actions = memberActions({ userId: 'me', role: 'owner' }, owner, 1);
		expect(actions).toMatchObject({ isSelf: true, lastOwner: true, canDemote: true, canRemove: false });
	});

	test('an owner among several can be demoted', () => {
		expect(memberActions({ userId: 'u2', role: 'owner' }, owner, 2)).toMatchObject({ lastOwner: false, canDemote: true });
	});

	test('plain members cannot change anyone', () => {
		expect(memberActions({ userId: 'u2', role: 'owner' }, member, 1)).toMatchObject({ canPromote: false, canDemote: false, canRemove: false });
	});
});

describe('sshKeyInput', () => {
	test('generate sends only the trimmed name', () => {
		expect(sshKeyInput({ mode: 'generate', name: ' deploy ', privateKey: 'ignored' })).toEqual({ mode: 'generate', name: 'deploy' });
	});

	test('upload sends the trimmed private key', () => {
		expect(sshKeyInput({ mode: 'upload', name: 'deploy', privateKey: '\n-----BEGIN KEY-----\n' })).toEqual({
			mode: 'upload',
			name: 'deploy',
			privateKey: '-----BEGIN KEY-----'
		});
	});
});

describe('error messages', () => {
	test('member errors explain the last-owner rule', () => {
		expect(memberErrorMessage('last_owner')).toContain('at least one owner');
		expect(memberErrorMessage('boom')).toBe('Something went wrong. Please try again.');
	});

	test('adding an unknown email says the person needs an account', () => {
		expect(addMemberError('user_not_found')).toEqual({ title: 'No user with that email', description: 'The person must already have an account.' });
		expect(addMemberError('boom').title).toBe('Could not add member');
	});

	test('ssh key errors map known codes and fall back', () => {
		expect(sshKeyCreateError('ssh_key_passphrase_protected').title).toBe('Passphrase-protected key');
		expect(sshKeyCreateError('boom').title).toBe('Could not add SSH key');
		expect(sshKeyDeleteErrorMessage('ssh_key_not_found')).toBe('That key no longer exists.');
	});
});
