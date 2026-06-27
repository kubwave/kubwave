import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadAsset, getReleaseByTag, resolveLatestRelease, validateTargetForChannel, type ReleaseInfo } from '../src/lib/releases.js';

const originalFetch = globalThis.fetch;

function stubFetch(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch {
	return Object.assign(fn, { preconnect: originalFetch.preconnect }) as typeof fetch;
}

const release: ReleaseInfo = {
	tag: '0.1.0-alpha.26',
	version: '0.1.0-alpha.26',
	prerelease: true,
	assets: [
		{
			name: 'kubwave-darwin-arm64',
			size: 4,
			downloadUrl: 'https://api.github.com/repos/kubwave/kubwave/releases/assets/26'
		}
	]
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	delete process.env['GITHUB_TOKEN'];
	delete process.env['KUBWAVE_ASSET_DOWNLOAD_TIMEOUT_MS'];
});

describe('release asset download', () => {
	test('resolves the latest stable release through the GitHub API', async () => {
		process.env['GITHUB_TOKEN'] = 'test-token';
		let requestedUrl = '';
		let authorization = '';
		globalThis.fetch = stubFetch(async (url, init) => {
			requestedUrl = String(url);
			authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization);
			return Response.json({
				tag_name: 'v1.2.3',
				prerelease: false,
				draft: false,
				assets: [
					{
						name: 'kubwave-linux-x64',
						size: 10,
						url: 'https://api.github.com/repos/kubwave/kubwave/releases/assets/123'
					}
				]
			});
		});

		await expect(resolveLatestRelease('stable')).resolves.toEqual({
			tag: 'v1.2.3',
			version: '1.2.3',
			prerelease: false,
			assets: [
				{
					name: 'kubwave-linux-x64',
					size: 10,
					downloadUrl: 'https://api.github.com/repos/kubwave/kubwave/releases/assets/123'
				}
			]
		});
		expect(requestedUrl).toContain('/releases/latest');
		expect(authorization).toBe('Bearer test-token');
	});

	test('reports when no stable release exists', async () => {
		globalThis.fetch = stubFetch(async () => new Response('', { status: 404, statusText: 'Not Found' }));

		await expect(resolveLatestRelease('stable')).rejects.toThrow('No stable release published yet');
	});

	test('reports 401 unauthorized from GitHub API', async () => {
		process.env['GITHUB_TOKEN'] = 'bad-token';
		globalThis.fetch = stubFetch(async () => new Response('', { status: 401, statusText: 'Unauthorized' }));

		await expect(resolveLatestRelease('stable')).rejects.toThrow('GitHub API 401');
		await expect(resolveLatestRelease('stable')).rejects.toThrow('Token rejected');
	});

	test('reports 403 forbidden from GitHub API', async () => {
		process.env['GITHUB_TOKEN'] = 'bad-token';
		globalThis.fetch = stubFetch(async () => new Response('', { status: 403, statusText: 'Forbidden' }));

		await expect(resolveLatestRelease('stable')).rejects.toThrow('GitHub API 403');
	});

	test('rethrows non-404 errors from stable resolve', async () => {
		process.env['GITHUB_TOKEN'] = 'test-token';
		globalThis.fetch = stubFetch(async () => new Response('', { status: 500, statusText: 'Server Error' }));

		await expect(resolveLatestRelease('stable')).rejects.toThrow('GitHub API 500');
	});

	test('resolves preview from the first non-draft release', async () => {
		globalThis.fetch = stubFetch(async () =>
			Response.json([
				{ tag_name: 'v1.3.0-draft', prerelease: true, draft: true, assets: [] },
				{
					tag_name: 'v1.3.0-preview.1',
					prerelease: true,
					draft: false,
					assets: [{ name: 'asset', size: 3, url: 'https://api.github.com/repos/kubwave/kubwave/releases/assets/456' }]
				}
			])
		);

		await expect(resolveLatestRelease('preview')).resolves.toEqual({
			tag: 'v1.3.0-preview.1',
			version: '1.3.0-preview.1',
			prerelease: true,
			assets: [{ name: 'asset', size: 3, downloadUrl: 'https://api.github.com/repos/kubwave/kubwave/releases/assets/456' }]
		});
	});

	test('reports when preview has no published releases', async () => {
		globalThis.fetch = stubFetch(async () => Response.json([{ tag_name: 'v1.0.0', prerelease: false, draft: true }]));

		await expect(resolveLatestRelease('preview')).rejects.toThrow('No releases found.');
	});

	test('normalizes tag lookup', async () => {
		let requestedUrl = '';
		globalThis.fetch = stubFetch(async url => {
			requestedUrl = String(url);
			return Response.json({ tag_name: '1.2.3', prerelease: false, draft: false, assets: [] });
		});

		await expect(getReleaseByTag('v1.2.3')).resolves.toMatchObject({ tag: '1.2.3', version: '1.2.3' });
		expect(requestedUrl).toContain('/releases/tags/1.2.3');
	});

	test('reports missing release assets before attempting a download', async () => {
		const dest = join(tmpdir(), `kubwave-download-missing-${process.pid}-${Date.now()}`);

		await expect(downloadAsset({ ...release, assets: [] }, 'kubwave-darwin-arm64', dest)).rejects.toThrow(
			"does not contain asset 'kubwave-darwin-arm64'"
		);
	});

	test('writes the downloaded asset body', async () => {
		process.env['GITHUB_TOKEN'] = 'test-token';
		const dest = join(tmpdir(), `kubwave-download-${process.pid}-${Date.now()}`);
		globalThis.fetch = stubFetch(async () => new Response('test', { status: 200 }));

		try {
			await downloadAsset(release, 'kubwave-darwin-arm64', dest);
			expect(await Bun.file(dest).text()).toBe('test');
		} finally {
			if (existsSync(dest)) unlinkSync(dest);
		}
	});

	test('fails instead of hanging when the asset request stalls', async () => {
		process.env['GITHUB_TOKEN'] = 'test-token';
		process.env['KUBWAVE_ASSET_DOWNLOAD_TIMEOUT_MS'] = '5';
		const dest = join(tmpdir(), `kubwave-download-timeout-${process.pid}-${Date.now()}`);
		globalThis.fetch = stubFetch((_, init) => {
			return new Promise<Response>((_, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			});
		});

		try {
			await expect(downloadAsset(release, 'kubwave-darwin-arm64', dest)).rejects.toThrow('Asset download timed out');
		} finally {
			if (existsSync(dest)) unlinkSync(dest);
		}
	});

	test('reports failed asset status responses', async () => {
		process.env['GITHUB_TOKEN'] = 'test-token';
		const dest = join(tmpdir(), `kubwave-download-404-${process.pid}-${Date.now()}`);
		globalThis.fetch = stubFetch(async () => new Response('', { status: 404, statusText: 'Not Found' }));

		try {
			await expect(downloadAsset(release, 'kubwave-darwin-arm64', dest)).rejects.toThrow('Asset download failed: 404 Not Found');
		} finally {
			if (existsSync(dest)) unlinkSync(dest);
		}
	});
});

describe('validateTargetForChannel', () => {
	test('rejects prerelease targets on the stable channel', () => {
		expect(() => validateTargetForChannel('1.2.3-alpha.1', 'stable')).toThrow('Stable channel only accepts non-prerelease semver versions');
		expect(() => validateTargetForChannel('v1.2.3-preview.1', 'stable')).toThrow('Stable channel only accepts non-prerelease semver versions');
	});

	test('allows prerelease targets on the preview channel', () => {
		expect(() => validateTargetForChannel('1.2.3-alpha.1', 'preview')).not.toThrow();
		expect(() => validateTargetForChannel('v1.2.3-preview.1', 'preview')).not.toThrow();
	});

	test('rejects dev builds on the stable channel but allows them on preview', () => {
		expect(() => validateTargetForChannel('dev', 'stable')).toThrow('Stable channel only accepts non-prerelease semver versions');
		expect(() => validateTargetForChannel('dev', 'preview')).not.toThrow();
	});

	test('allows non-prerelease versions on the stable channel', () => {
		expect(() => validateTargetForChannel('1.2.3', 'stable')).not.toThrow();
		expect(() => validateTargetForChannel('v1.2.3', 'stable')).not.toThrow();
	});
});
