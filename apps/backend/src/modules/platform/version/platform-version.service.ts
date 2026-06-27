import { Injectable } from '@nestjs/common';
import { BackendConfigService } from '../../../shared/config/backend-config.service.js';
import { SettingsService } from '../../../shared/settings/settings.service.js';
import type { AvailableVersion, PlatformVersionCheckResultDto, PlatformVersionInfoDto, VersionState } from './platform-version.dto.js';

export const PLATFORM_VERSION_KEY = 'platform_version';

const DEFAULT_STATE: VersionState = {
	latestVersion: null,
	availableVersions: [],
	lastCheckedAt: null,
	lastEtag: null
};

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/kubwave/kubwave/releases';

@Injectable()
export class PlatformVersionService {
	private checking = false;
	private writeChain: Promise<void> = Promise.resolve();

	constructor(
		private readonly config: BackendConfigService,
		private readonly settings: SettingsService
	) {}

	getInstalledVersion(): string {
		return this.config.api.appVersion.replace(/^v/, '');
	}

	async getVersionInfo(): Promise<PlatformVersionInfoDto> {
		const state = await this.getVersionState();
		return {
			currentVersion: this.getInstalledVersion(),
			latestVersion: state.latestVersion,
			availableVersions: state.availableVersions,
			lastCheckedAt: state.lastCheckedAt
		};
	}

	async checkForUpdates(): Promise<PlatformVersionCheckResultDto> {
		if (this.checking) return { success: false, message: 'A version check is already in progress' };

		this.checking = true;
		try {
			const state = await this.getVersionState();
			const onPrereleaseChannel = /-/.test(this.getInstalledVersion());
			const headers: Record<string, string> = {
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'kubwave-api'
			};

			if (state.lastEtag) headers['If-None-Match'] = state.lastEtag;

			let response: Response;
			try {
				response = await fetch(GITHUB_RELEASES_URL, { headers });
			} catch (err) {
				const message = `Failed to reach GitHub API: ${err instanceof Error ? err.message : String(err)}`;
				await this.patchVersionState({ lastCheckedAt: new Date().toISOString() });
				console.error('[platform-version]', message);
				return { success: false, message };
			}

			if (response.status === 304) {
				await this.patchVersionState({ lastCheckedAt: new Date().toISOString() });
				return { success: true, message: 'No new releases (304 Not Modified)' };
			}

			if (!response.ok) {
				const hint =
					response.status === 404
						? 'repository not found or no releases published'
						: response.status === 403
							? 'GitHub API rate limit exceeded - retry later'
							: '';
				const message = `GitHub API returned ${response.status}${hint ? ` - ${hint}` : ''}`;
				await this.patchVersionState({ lastCheckedAt: new Date().toISOString() });
				console.error('[platform-version]', message);
				return { success: false, message };
			}

			const etag = response.headers.get('etag');
			const releases = (await response.json()) as Array<{
				tag_name: string;
				html_url: string | null;
				published_at: string | null;
				draft: boolean;
				prerelease: boolean;
			}>;

			const availableVersions: AvailableVersion[] = releases
				.filter(release => !release.draft && (onPrereleaseChannel || !release.prerelease))
				.map(release => ({
					version: release.tag_name.replace(/^v/, ''),
					changelogUrl: release.html_url,
					publishedAt: release.published_at
				}));
			const latestVersion = availableVersions[0]?.version ?? null;

			await this.patchVersionState({
				latestVersion,
				availableVersions,
				lastCheckedAt: new Date().toISOString(),
				lastEtag: etag
			});

			return { success: true, message: `Found ${availableVersions.length} releases, latest: ${latestVersion ?? 'none'}` };
		} finally {
			this.checking = false;
		}
	}

	private async getVersionState(): Promise<VersionState> {
		return (await this.settings.get<VersionState>(PLATFORM_VERSION_KEY)) ?? DEFAULT_STATE;
	}

	private async patchVersionState(patch: Partial<VersionState>): Promise<VersionState> {
		let next!: VersionState;
		this.writeChain = this.writeChain
			.catch(() => {})
			.then(async () => {
				next = { ...(await this.getVersionState()), ...patch };
				await this.settings.set(PLATFORM_VERSION_KEY, next);
			});
		await this.writeChain;
		return next;
	}
}
