import { describe, expect, test } from 'bun:test';
import {
	appsNewUrl,
	buildAppManifest,
	consoleGitSettingsUrl,
	defaultAppName,
	githubCallbackUrl,
	githubWebhookUrl,
	installUrl,
	isPubliclyReachable,
	parseManifestConversion
} from '~/modules/git/git-manifest';

describe('buildAppManifest', () => {
	test('wires callback/webhook/setup URLs off the app base and requests the needed scopes', () => {
		const m = buildAppManifest('https://console.example.com/');
		expect(m.redirect_url).toBe('https://console.example.com/api/git/github/callback');
		expect(m.hook_attributes?.url).toBe('https://console.example.com/api/git/github/webhook');
		expect(m.setup_url).toBe('https://console.example.com/team/settings?tab=github');
		expect(m.public).toBe(false);
		expect(m.default_events).toEqual(['push', 'pull_request']);
		expect(m.default_permissions).toMatchObject({ contents: 'read', pull_requests: 'write', statuses: 'write' });
	});

	test('omits the hook (and events) when the base URL is not publicly reachable', () => {
		const m = buildAppManifest('http://console.localhost');
		expect(m.hook_attributes).toBeUndefined();
		expect(m.default_events).toBeUndefined();
		// The rest of the manifest is still produced so the App can be created locally.
		expect(m.redirect_url).toBe('http://console.localhost/api/git/github/callback');
		expect(m.default_permissions).toMatchObject({ contents: 'read' });
	});

	test('trailing slash on the base URL never doubles the path', () => {
		expect(githubCallbackUrl('https://x.io//')).toBe('https://x.io/api/git/github/callback');
		expect(githubWebhookUrl('https://x.io')).toBe('https://x.io/api/git/github/webhook');
		expect(consoleGitSettingsUrl('https://x.io/', { connected: '1' })).toBe('https://x.io/admin/settings?connected=1');
	});
});

describe('isPubliclyReachable', () => {
	test('rejects localhost, loopback, private, and non-FQDN hosts', () => {
		for (const url of [
			'http://console.localhost',
			'http://localhost:3000',
			'http://127.0.0.1',
			'http://backend',
			'http://10.1.2.3',
			'http://192.168.0.5'
		]) {
			expect(isPubliclyReachable(url)).toBe(false);
		}
	});

	test('accepts a public FQDN', () => {
		expect(isPubliclyReachable('https://console.acme.dev')).toBe(true);
		expect(isPubliclyReachable('https://kubwave.example.com')).toBe(true);
	});
});

describe('defaultAppName', () => {
	test('derives a unique, GitHub-legal slug from the host', () => {
		const name = defaultAppName('https://console.acme.dev');
		expect(name).toBe('kubwave-console-acme-dev');
		expect(name.length).toBeLessThanOrEqual(34);
		expect(name).toMatch(/^[a-z0-9-]+$/);
	});
});

describe('appsNewUrl / installUrl', () => {
	test('personal vs org creation targets, state encoded', () => {
		expect(appsNewUrl('a b')).toBe('https://github.com/settings/apps/new?state=a%20b');
		expect(appsNewUrl('s', 'acme')).toBe('https://github.com/organizations/acme/settings/apps/new?state=s');
		expect(installUrl('my-app')).toBe('https://github.com/apps/my-app/installations/new');
	});
});

describe('parseManifestConversion', () => {
	const valid = { id: 123456, slug: 'kubwave-x', client_id: 'Iv1.abc', client_secret: 'cs', pem: '-----BEGIN-----', webhook_secret: 'wh' };

	test('extracts and stringifies the persisted fields', () => {
		expect(parseManifestConversion(valid)).toEqual({
			appId: '123456',
			slug: 'kubwave-x',
			clientId: 'Iv1.abc',
			clientSecret: 'cs',
			pem: '-----BEGIN-----',
			webhookSecret: 'wh'
		});
	});

	test('tolerates a missing client_id/secret (null)', () => {
		const { id, slug, pem, webhook_secret } = valid;
		const parsed = parseManifestConversion({ id, slug, pem, webhook_secret });
		expect(parsed.clientId).toBeNull();
		expect(parsed.clientSecret).toBeNull();
	});

	test('tolerates a missing webhook_secret (App created without a hook) as empty', () => {
		const { id, slug, pem } = valid;
		expect(parseManifestConversion({ id, slug, pem }).webhookSecret).toBe('');
	});

	test('throws when a required field is absent', () => {
		expect(() => parseManifestConversion({ ...valid, pem: undefined })).toThrow('private key');
		expect(() => parseManifestConversion({ ...valid, id: undefined })).toThrow('app id');
	});
});
