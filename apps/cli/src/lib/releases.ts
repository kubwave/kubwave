import { resolveGithubToken, authHint } from '~/lib/auth.js';
import type { Channel } from '~/lib/channel.js';

const GITHUB_REPO = 'kubwave/kubwave';
const API_BASE = `https://api.github.com/repos/${GITHUB_REPO}`;
const DEFAULT_ASSET_DOWNLOAD_TIMEOUT_MS = 120_000;

export interface ReleaseAsset {
	name: string;
	size: number;
	downloadUrl: string;
}

export interface ReleaseInfo {
	tag: string;
	version: string;
	prerelease: boolean;
	assets: ReleaseAsset[];
}

interface GithubRelease {
	tag_name: string;
	prerelease: boolean;
	draft: boolean;
	assets?: { name: string; size: number; url: string; browser_download_url?: string }[];
}

async function githubHeaders(accept: string = 'application/vnd.github+json'): Promise<Record<string, string>> {
	const headers: Record<string, string> = {
		Accept: accept,
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'cli'
	};
	const token = await resolveGithubToken();
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

async function githubFetch(url: string): Promise<Response> {
	const headers = await githubHeaders();
	const res = await fetch(url, { headers });
	if (!res.ok) {
		const token = await resolveGithubToken();
		if (res.status === 404 && !token) {
			throw new Error(`GitHub API 404 for ${url}. ${authHint()}`);
		}
		if (res.status === 401 || res.status === 403) {
			throw new Error(`GitHub API ${res.status} for ${url}. Token rejected or insufficient scopes. ${authHint()}`);
		}
		throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}`);
	}
	return res;
}

function toReleaseInfo(r: GithubRelease): ReleaseInfo {
	return {
		tag: r.tag_name,
		version: r.tag_name.replace(/^v/, ''),
		prerelease: r.prerelease,
		assets: (r.assets ?? []).map(a => ({ name: a.name, size: a.size, downloadUrl: a.url || a.browser_download_url || '' }))
	};
}

export async function resolveLatestRelease(channel: Channel): Promise<ReleaseInfo> {
	if (channel === 'stable') {
		try {
			const res = await githubFetch(`${API_BASE}/releases/latest`);
			const json = (await res.json()) as GithubRelease;
			return toReleaseInfo(json);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('404')) {
				throw new Error('No stable release published yet. Use --channel preview or pin a specific --target version.');
			}
			throw err;
		}
	}

	const res = await githubFetch(`${API_BASE}/releases?per_page=20`);
	const list = (await res.json()) as GithubRelease[];
	const candidate = list.find(r => !r.draft);
	if (!candidate) {
		throw new Error('No releases found.');
	}
	return toReleaseInfo(candidate);
}

export async function getReleaseByTag(tag: string): Promise<ReleaseInfo> {
	const normalized = tag.replace(/^v/, '');
	const res = await githubFetch(`${API_BASE}/releases/tags/${encodeURIComponent(normalized)}`);
	const json = (await res.json()) as GithubRelease;
	return toReleaseInfo(json);
}

export function validateTargetForChannel(tag: string, channel: Channel): void {
	const v = tag.replace(/^v/, '');
	if (channel === 'stable' && !isStableSemver(v)) {
		throw new Error(
			`Tag '${tag}' is not a stable release version. Stable channel only accepts non-prerelease semver versions. Use --channel preview to install it.`
		);
	}
}

function isStableSemver(version: string): boolean {
	return /^\d+\.\d+\.\d+$/.test(version);
}

export function platformAssetName(): string {
	const platform = process.platform;
	const arch = process.arch;

	let os: 'linux' | 'darwin';
	if (platform === 'linux') os = 'linux';
	else if (platform === 'darwin') os = 'darwin';
	else throw new Error(`Unsupported platform: ${platform}. Only linux and darwin are supported.`);

	let archName: 'x64' | 'arm64';
	if (arch === 'x64') archName = 'x64';
	else if (arch === 'arm64') archName = 'arm64';
	else throw new Error(`Unsupported architecture: ${arch}. Only x64 and arm64 are supported.`);

	return `kubwave-${os}-${archName}`;
}

export async function downloadAsset(release: ReleaseInfo, assetName: string, destPath: string): Promise<void> {
	const asset = release.assets.find(a => a.name === assetName);
	if (!asset) {
		throw new Error(
			`Release ${release.tag} does not contain asset '${assetName}'. Available: ${release.assets.map(a => a.name).join(', ') || '(none)'}`
		);
	}

	const headers = await githubHeaders('application/octet-stream');
	const token = await resolveGithubToken();

	const url = asset.downloadUrl;
	const timeoutMs = assetDownloadTimeoutMs();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
		if (!res.ok) {
			if (res.status === 404 && !token) {
				throw new Error(`Asset download 404 for ${url}. ${authHint()}`);
			}
			throw new Error(`Asset download failed: ${res.status} ${res.statusText} (${url})`);
		}

		const body = await res.arrayBuffer();
		await Bun.write(destPath, body);
	} catch (err) {
		if (controller.signal.aborted) {
			throw new Error(`Asset download timed out after ${timeoutMs / 1000}s: ${assetName} (${url})`, { cause: err });
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}
}

function assetDownloadTimeoutMs(): number {
	const raw = process.env['KUBWAVE_ASSET_DOWNLOAD_TIMEOUT_MS'];
	if (!raw) return DEFAULT_ASSET_DOWNLOAD_TIMEOUT_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASSET_DOWNLOAD_TIMEOUT_MS;
}
