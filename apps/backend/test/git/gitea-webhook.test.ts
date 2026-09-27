import { describe, expect, test } from 'bun:test';
import { parseGiteaWebhookEvent } from '~/modules/git/gitea-webhook';

describe('parseGiteaWebhookEvent', () => {
	test('a branch push resolves to a push action with repo + branch', () => {
		expect(parseGiteaWebhookEvent('push', { ref: 'refs/heads/main', after: 'c'.repeat(40), repository: { full_name: 'acme/api' } })).toEqual({
			kind: 'push',
			repoFullName: 'acme/api',
			branch: 'main'
		});
	});

	test('tag pushes and branch deletions are ignored', () => {
		expect(parseGiteaWebhookEvent('push', { ref: 'refs/tags/v1', after: 'c'.repeat(40), repository: { full_name: 'acme/api' } })).toMatchObject({
			kind: 'ignored'
		});
		expect(parseGiteaWebhookEvent('push', { ref: 'refs/heads/main', after: '0'.repeat(40), repository: { full_name: 'acme/api' } })).toMatchObject({
			kind: 'ignored'
		});
		expect(
			parseGiteaWebhookEvent('push', { ref: 'refs/heads/main', deleted: true, after: 'c'.repeat(40), repository: { full_name: 'acme/api' } })
		).toMatchObject({
			kind: 'ignored'
		});
	});

	test('pull_request / unknown are ignored', () => {
		expect(parseGiteaWebhookEvent('pull_request', { action: 'opened', repository: { full_name: 'acme/api' } })).toMatchObject({ kind: 'ignored' });
		expect(parseGiteaWebhookEvent('create', { ref: 'main', repository: { full_name: 'acme/api' } })).toMatchObject({ kind: 'ignored' });
	});

	test('a push without a repo full name is ignored', () => {
		expect(parseGiteaWebhookEvent('push', { ref: 'refs/heads/main', after: 'c'.repeat(40) })).toMatchObject({ kind: 'ignored' });
	});
});
