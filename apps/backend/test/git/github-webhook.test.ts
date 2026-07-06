import { describe, expect, test } from 'bun:test';
import { parseWebhookEvent } from '~/modules/git/github-webhook';

const inst = { installation: { id: 42 } };

describe('parseWebhookEvent', () => {
	test('installation lifecycle actions', () => {
		expect(parseWebhookEvent('installation', { ...inst, action: 'deleted' })).toEqual({ kind: 'installation-deleted', githubInstallationId: '42' });
		expect(parseWebhookEvent('installation', { ...inst, action: 'suspend' })).toEqual({
			kind: 'installation-suspended',
			githubInstallationId: '42',
			suspended: true
		});
		expect(parseWebhookEvent('installation', { ...inst, action: 'unsuspend' })).toEqual({
			kind: 'installation-suspended',
			githubInstallationId: '42',
			suspended: false
		});
	});

	test('installation.created is ignored (creation is redirect-driven)', () => {
		expect(parseWebhookEvent('installation', { ...inst, action: 'created' })).toMatchObject({ kind: 'ignored' });
	});

	test('repositories added maps full_name + private, defaulting private to true', () => {
		const action = parseWebhookEvent('installation_repositories', {
			...inst,
			action: 'added',
			repositories_added: [{ full_name: 'acme/api', private: true }, { full_name: 'acme/web', private: false }, { id: 1 }]
		});
		expect(action).toEqual({
			kind: 'repos-added',
			githubInstallationId: '42',
			repos: [
				{ fullName: 'acme/api', isPrivate: true },
				{ fullName: 'acme/web', isPrivate: false }
			]
		});
	});

	test('repositories removed collapses to full-name list', () => {
		expect(parseWebhookEvent('installation_repositories', { ...inst, action: 'removed', repositories_removed: [{ full_name: 'acme/api' }] })).toEqual(
			{ kind: 'repos-removed', githubInstallationId: '42', repoFullNames: ['acme/api'] }
		);
	});

	test('a branch push resolves to a push action with repo + branch', () => {
		expect(parseWebhookEvent('push', { ...inst, ref: 'refs/heads/main', after: 'c'.repeat(40), repository: { full_name: 'acme/api' } })).toEqual({
			kind: 'push',
			githubInstallationId: '42',
			repoFullName: 'acme/api',
			branch: 'main'
		});
	});

	test('tag pushes and branch deletions are ignored', () => {
		expect(parseWebhookEvent('push', { ...inst, ref: 'refs/tags/v1', after: 'c'.repeat(40), repository: { full_name: 'acme/api' } })).toMatchObject({
			kind: 'ignored'
		});
		expect(
			parseWebhookEvent('push', { ...inst, ref: 'refs/heads/main', after: '0'.repeat(40), repository: { full_name: 'acme/api' } })
		).toMatchObject({
			kind: 'ignored'
		});
	});

	test('pull_request / unknown are ignored', () => {
		expect(parseWebhookEvent('pull_request', { ...inst, action: 'opened' })).toMatchObject({ kind: 'ignored' });
	});

	test('a payload without an installation id is ignored', () => {
		expect(parseWebhookEvent('installation', { action: 'deleted' })).toMatchObject({ kind: 'ignored' });
	});
});
