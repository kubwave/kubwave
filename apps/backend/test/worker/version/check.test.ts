import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// check.ts polls the GitHub releases API and read-merge-writes a cached VersionState; the installed version drives the channel.

// Mutated in place: check.ts destructures `import { env }` once at load, so the shared ref must be mutated.
const fakeEnv: { appVersion: string; githubToken: string | undefined } = { appVersion: '1.2.3', githubToken: undefined };
mock.module('~/shared/config/worker-env', () => ({ env: fakeEnv }));

let storedState: unknown = null;
const setSettingCalls: Array<{ key: string; value: unknown }> = [];

mock.module('~/shared/worker-common/settings', () => ({
	getSetting: async () => storedState,
	setSetting: async (key: string, value: unknown) => {
		setSettingCalls.push({ key, value });
		storedState = value;
	}
}));

const { checkForUpdates, getInstalledVersion, PLATFORM_VERSION_KEY } = await import('~/modules/worker/jobs/version/check');

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});
beforeEach(() => {
	storedState = null;
	setSettingCalls.length = 0;
	fakeEnv.githubToken = undefined;
	fakeEnv.appVersion = '1.2.3';
});

// Minimal release row matching the fields check.ts reads off the GitHub API.
function release(tag: string, opts: Partial<{ draft: boolean; prerelease: boolean; html_url: string; published_at: string }> = {}) {
	return {
		tag_name: tag,
		html_url: opts.html_url ?? `https://github.com/kubwave/kubwave/releases/tag/${tag}`,
		published_at: opts.published_at ?? '2026-01-01T00:00:00Z',
		draft: opts.draft ?? false,
		prerelease: opts.prerelease ?? false
	};
}

// Build a fake Response-like for the fields check.ts reads: status, ok, headers.get, json().
function fakeResponse(status: number, body: unknown, etag: string | null = null): Response {
	return {
		status,
		ok: status >= 200 && status < 300,
		headers: { get: (k: string) => (k.toLowerCase() === 'etag' ? etag : null) },
		json: async () => body
	} as unknown as Response;
}

describe('getInstalledVersion', () => {
	test('strips a leading v to match GitHub-derived tags', () => {
		fakeEnv.appVersion = 'v0.1.0-alpha.21';
		expect(getInstalledVersion()).toBe('0.1.0-alpha.21');
	});

	test('passes a version without a leading v through unchanged', () => {
		fakeEnv.appVersion = '1.2.3';
		expect(getInstalledVersion()).toBe('1.2.3');
	});
});

describe('checkForUpdates — channel selection', () => {
	test('stable install excludes prereleases', async () => {
		fakeEnv.appVersion = '1.2.3';
		globalThis.fetch = (async () => fakeResponse(200, [release('1.3.0'), release('1.3.1-rc.1', { prerelease: true })])) as unknown as typeof fetch;

		const result = await checkForUpdates();

		expect(result.success).toBe(true);
		const state = storedState as { availableVersions: Array<{ version: string }>; latestVersion: string | null };
		expect(state.availableVersions.map(v => v.version)).toEqual(['1.3.0']);
		expect(state.latestVersion).toBe('1.3.0');
	});

	test('prerelease install (tag like 0.1.0-alpha.21) opts into prereleases', async () => {
		fakeEnv.appVersion = '0.1.0-alpha.21';
		globalThis.fetch = (async () =>
			fakeResponse(200, [release('0.1.0-alpha.22', { prerelease: true }), release('0.1.0', {})])) as unknown as typeof fetch;

		await checkForUpdates();

		const state = storedState as { availableVersions: Array<{ version: string }> };
		expect(state.availableVersions.map(v => v.version)).toEqual(['0.1.0-alpha.22', '0.1.0']);
	});
});

describe('checkForUpdates — filtering and latestVersion', () => {
	test('filters drafts, strips leading v, and latestVersion is the first available', async () => {
		fakeEnv.appVersion = '1.0.0';
		globalThis.fetch = (async () =>
			fakeResponse(200, [
				release('v2.0.0'), // newest, leading v stripped
				release('1.9.0-beta', { prerelease: true }), // dropped (stable channel)
				release('1.8.0', { draft: true }), // dropped (draft)
				release('1.7.0')
			])) as unknown as typeof fetch;

		const result = await checkForUpdates();

		const state = storedState as {
			availableVersions: Array<{ version: string; changelogUrl: string | null; publishedAt: string | null }>;
			latestVersion: string | null;
		};
		expect(state.availableVersions.map(v => v.version)).toEqual(['2.0.0', '1.7.0']);
		expect(state.latestVersion).toBe('2.0.0');
		expect(state.availableVersions[0]!.changelogUrl).toBe('https://github.com/kubwave/kubwave/releases/tag/v2.0.0');
		expect(state.availableVersions[0]!.publishedAt).toBe('2026-01-01T00:00:00Z');
		expect(result.message).toBe('Found 2 releases, latest: 2.0.0');
	});

	test('latestVersion is null when no releases survive filtering', async () => {
		fakeEnv.appVersion = '1.0.0';
		globalThis.fetch = (async () => fakeResponse(200, [release('1.1.0-rc', { prerelease: true })])) as unknown as typeof fetch;

		const result = await checkForUpdates();

		expect((storedState as { latestVersion: string | null }).latestVersion).toBeNull();
		expect(result.message).toBe('Found 0 releases, latest: none');
	});
});

describe('checkForUpdates — request headers', () => {
	test('sends the GITHUB_TOKEN auth header (Bearer scheme) and the If-None-Match etag', async () => {
		fakeEnv.githubToken = 'secret-token';
		storedState = { latestVersion: null, availableVersions: [], lastCheckedAt: null, lastEtag: 'W/"abc"' };
		let capturedHeaders: Record<string, string> = {};
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			capturedHeaders = (init?.headers as Record<string, string>) ?? {};
			return fakeResponse(200, []);
		}) as unknown as typeof fetch;

		await checkForUpdates();

		expect(capturedHeaders['Authorization']).toBe('Bearer secret-token');
		expect(capturedHeaders['If-None-Match']).toBe('W/"abc"');
		expect(capturedHeaders['Accept']).toBe('application/vnd.github+json');
		expect(capturedHeaders['X-GitHub-Api-Version']).toBe('2022-11-28');
	});

	test('omits the auth header when no GITHUB_TOKEN is set', async () => {
		fakeEnv.githubToken = undefined;
		let capturedHeaders: Record<string, string> = {};
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			capturedHeaders = (init?.headers as Record<string, string>) ?? {};
			return fakeResponse(200, []);
		}) as unknown as typeof fetch;

		await checkForUpdates();

		expect(capturedHeaders['Authorization']).toBeUndefined();
		expect(capturedHeaders['If-None-Match']).toBeUndefined();
	});

	test('persists the response etag into lastEtag for the next conditional request', async () => {
		globalThis.fetch = (async () => fakeResponse(200, [], 'W/"new-etag"')) as unknown as typeof fetch;
		await checkForUpdates();
		expect((storedState as { lastEtag: string | null }).lastEtag).toBe('W/"new-etag"');
	});
});

describe('checkForUpdates — non-2xx and error paths', () => {
	test('304 Not Modified: success, bumps lastCheckedAt, leaves availableVersions untouched', async () => {
		storedState = { latestVersion: '9.9.9', availableVersions: [{ version: '9.9.9' }], lastCheckedAt: null, lastEtag: 'e' };
		globalThis.fetch = (async () => fakeResponse(304, null)) as unknown as typeof fetch;

		const result = await checkForUpdates();

		expect(result).toEqual({ success: true, message: 'No new releases (304 Not Modified)' });
		const state = storedState as { latestVersion: string; lastCheckedAt: string | null };
		expect(state.latestVersion).toBe('9.9.9'); // not overwritten
		expect(state.lastCheckedAt).not.toBeNull(); // touched
	});

	test('404 returns the repo-not-found hint', async () => {
		globalThis.fetch = (async () => fakeResponse(404, null)) as unknown as typeof fetch;
		const result = await checkForUpdates();
		expect(result.success).toBe(false);
		expect(result.message).toContain('GitHub API returned 404');
		expect(result.message).toContain('repository not found or no releases published');
	});

	test('401 returns the auth-failed hint', async () => {
		globalThis.fetch = (async () => fakeResponse(401, null)) as unknown as typeof fetch;
		const result = await checkForUpdates();
		expect(result.success).toBe(false);
		expect(result.message).toContain('GitHub API returned 401');
		expect(result.message).toContain('check GITHUB_TOKEN scopes');
	});

	test('403 returns the auth-failed hint', async () => {
		globalThis.fetch = (async () => fakeResponse(403, null)) as unknown as typeof fetch;
		const result = await checkForUpdates();
		expect(result.message).toContain('GitHub API returned 403');
		expect(result.message).toContain('check GITHUB_TOKEN scopes');
	});

	test('a non-special non-2xx (500) returns the bare status with no hint', async () => {
		globalThis.fetch = (async () => fakeResponse(500, null)) as unknown as typeof fetch;
		const result = await checkForUpdates();
		expect(result.success).toBe(false);
		expect(result.message).toBe('GitHub API returned 500');
	});

	test('network error: caught, surfaced as failure, lastCheckedAt still bumped', async () => {
		globalThis.fetch = (async () => {
			throw new Error('ECONNREFUSED');
		}) as unknown as typeof fetch;

		const result = await checkForUpdates();

		expect(result.success).toBe(false);
		expect(result.message).toBe('Failed to reach GitHub API: ECONNREFUSED');
		expect((storedState as { lastCheckedAt: string | null }).lastCheckedAt).not.toBeNull();
	});
});

describe('PLATFORM_VERSION_KEY', () => {
	test('writes are keyed under the platform_version setting', async () => {
		globalThis.fetch = (async () => fakeResponse(200, [])) as unknown as typeof fetch;
		await checkForUpdates();
		expect(setSettingCalls.every(c => c.key === PLATFORM_VERSION_KEY)).toBe(true);
		expect(PLATFORM_VERSION_KEY).toBe('platform_version');
	});
});
