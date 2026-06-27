import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { getSetting, setSetting } from '../../../../shared/worker-common/settings.js';

interface AvailableVersion {
	version: string;
	changelogUrl: string | null;
	publishedAt: string | null;
}

// Single `settings` row holding the GitHub-releases cache (jsonb); the installed version isn't stored here — it's this pod's image tag (env.appVersion).
export const PLATFORM_VERSION_KEY = 'platform_version';

export interface VersionState {
	latestVersion: string | null;
	availableVersions: AvailableVersion[];
	lastCheckedAt: string | null; // ISO string
	lastEtag: string | null;
}

const DEFAULT_STATE: VersionState = {
	latestVersion: null,
	availableVersions: [],
	lastCheckedAt: null,
	lastEtag: null
};

// Running image's version, normalized to match GitHub tags (leading `v` stripped); pod-local, so old and new pods report their own during a rolling update.
export function getInstalledVersion(): string {
	return env.appVersion.replace(/^v/, '');
}

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/kubwave/kubwave/releases';

async function getVersionState(): Promise<VersionState> {
	return (await getSetting<VersionState>(PLATFORM_VERSION_KEY)) ?? DEFAULT_STATE;
}

// Read-merge-write the jsonb blob, serialized through a promise chain so the background poller can't clobber a concurrent write.
let versionWriteChain: Promise<void> = Promise.resolve();

async function patchVersionState(patch: Partial<VersionState>): Promise<VersionState> {
	let next!: VersionState;
	versionWriteChain = versionWriteChain
		.catch(() => {})
		.then(async () => {
			next = { ...(await getVersionState()), ...patch };
			await setSetting(PLATFORM_VERSION_KEY, next);
		});
	await versionWriteChain;
	return next;
}

export async function checkForUpdates(): Promise<{ success: boolean; message: string }> {
	const state = await getVersionState();
	// Prerelease install tags (e.g. 0.1.0-alpha.21) opt into prerelease updates; stable stays stable.
	const onPrereleaseChannel = /-/.test(getInstalledVersion());

	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'kubwave-worker'
	};

	if (env.githubToken) {
		headers['Authorization'] = `Bearer ${env.githubToken}`;
	}

	if (state.lastEtag) {
		headers['If-None-Match'] = state.lastEtag;
	}

	let response: Response;
	try {
		response = await fetch(GITHUB_RELEASES_URL, { headers });
	} catch (err) {
		const message = `Failed to reach GitHub API: ${errorMessage(err)}`;
		await patchVersionState({ lastCheckedAt: new Date().toISOString() });
		console.error('[version]', message);
		return { success: false, message };
	}

	if (response.status === 304) {
		await patchVersionState({ lastCheckedAt: new Date().toISOString() });
		return { success: true, message: 'No new releases (304 Not Modified)' };
	}

	if (!response.ok) {
		const hint =
			response.status === 404
				? 'repository not found or no releases published'
				: response.status === 401 || response.status === 403
					? 'GitHub authentication/authorization failed - check GITHUB_TOKEN scopes'
					: '';
		const message = `GitHub API returned ${response.status}${hint ? ` - ${hint}` : ''}`;
		await patchVersionState({ lastCheckedAt: new Date().toISOString() });
		console.error('[version]', message);
		return { success: false, message };
	}

	const etag = response.headers.get('etag');
	const releases = (await response.json()) as Array<{
		tag_name: string;
		html_url: string;
		published_at: string;
		draft: boolean;
		prerelease: boolean;
	}>;

	const availableVersions: AvailableVersion[] = releases
		.filter(r => !r.draft && (onPrereleaseChannel || !r.prerelease))
		.map(r => ({
			version: r.tag_name.replace(/^v/, ''),
			changelogUrl: r.html_url,
			publishedAt: r.published_at
		}));

	const latestVersion = availableVersions[0]?.version ?? null;

	await patchVersionState({
		latestVersion,
		availableVersions,
		lastCheckedAt: new Date().toISOString(),
		lastEtag: etag
	});

	return { success: true, message: `Found ${availableVersions.length} releases, latest: ${latestVersion ?? 'none'}` };
}
