import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { db, gitAppConnections, type GitAppConnection } from '@kubwave/db';
import { decryptSecret, encryptSecret } from '@kubwave/crypto';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { clearInstallationTokenCache, signAppJwt } from './installation-token.js';
import { appsNewUrl, buildAppManifest, consoleGitSettingsUrl, installUrl, parseManifestConversion } from './git-manifest.js';
import type { GithubConnectionDto, GithubManifestDto } from './git-connection.dto.js';

const STATE_PURPOSE = 'github-app-manifest';
const INSTALL_STATE_PURPOSE = 'github-app-install';
const INSTALL_GRANT_PURPOSE = 'github-install-grant';
const GITHUB_API = 'https://api.github.com';

@Injectable()
export class GitConnectionService {
	constructor(private readonly config: BackendConfigService) {}

	private stateSecret(): Uint8Array {
		return new TextEncoder().encode(this.config.api.jwtSecret);
	}

	async createManifest(organization: string | undefined, userId: string): Promise<GithubManifestDto> {
		const manifest = buildAppManifest(this.config.api.appBaseUrl);
		// State is minted only inside this admin-guarded call, so verifying it on the public callback proves an admin started the flow (CSRF guard).
		const state = await new SignJWT({ purpose: STATE_PURPOSE, uid: userId })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(this.stateSecret());
		return { postUrl: appsNewUrl(state, organization), manifest: JSON.stringify(manifest) };
	}

	private async verifyState(state: string): Promise<{ uid: string | null }> {
		try {
			const { payload } = await jwtVerify(state, this.stateSecret());
			if (payload.purpose !== STATE_PURPOSE) throw new Error('bad purpose');
			return { uid: typeof payload.uid === 'string' ? payload.uid : null };
		} catch {
			throw new ApiError(400, 'invalid_state');
		}
	}

	// Exchange the manifest code for App credentials, replacing any prior connection (single platform-wide App). Returns the slug for the install redirect.
	async completeManifest(code: string, state: string): Promise<{ slug: string }> {
		const { uid } = await this.verifyState(state);

		const res = await fetch(`${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
			method: 'POST',
			headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new ApiError(502, 'github_manifest_exchange_failed', body ? body.slice(0, 200) : undefined);
		}
		const conv = parseManifestConversion(await res.json());

		await db.transaction(async tx => {
			await tx.delete(gitAppConnections).where(eq(gitAppConnections.provider, 'github'));
			await tx.insert(gitAppConnections).values({
				provider: 'github',
				appId: conv.appId,
				appSlug: conv.slug,
				clientId: conv.clientId,
				clientSecretCiphertext: conv.clientSecret ? encryptSecret(conv.clientSecret) : null,
				privateKeyCiphertext: encryptSecret(conv.pem),
				webhookSecretCiphertext: encryptSecret(conv.webhookSecret),
				createdByUserId: uid
			});
		});
		clearInstallationTokenCache();
		return { slug: conv.slug };
	}

	// The single platform-wide App: completeManifest replaces the row wholesale, so newest-by-createdAt is the live connection.
	private async latestConnectionRow(): Promise<GitAppConnection | undefined> {
		const [row] = await db
			.select()
			.from(gitAppConnections)
			.where(eq(gitAppConnections.provider, 'github'))
			.orderBy(desc(gitAppConnections.createdAt))
			.limit(1);
		return row;
	}

	async getConnection(): Promise<GithubConnectionDto> {
		const row = await this.latestConnectionRow();
		if (!row) return { connected: false, appSlug: null, appId: null, installUrl: null, connectedAt: null };
		return {
			connected: true,
			appSlug: row.appSlug,
			appId: row.appId,
			installUrl: installUrl(row.appSlug),
			connectedAt: row.createdAt.toISOString()
		};
	}

	async getAppContext(): Promise<{ connectionId: string; appJwt: string } | null> {
		const row = await this.latestConnectionRow();
		if (!row) return null;
		return { connectionId: row.id, appJwt: signAppJwt(row.appId, decryptSecret(row.privateKeyCiphertext)) };
	}

	// State binds the install to the authenticated caller (uid+teamId); the callback trusts it because only this authed path mints it.
	async teamInstallUrl(uid: string, teamId: string, conn?: GithubConnectionDto): Promise<string | null> {
		const connection = conn ?? (await this.getConnection());
		if (!connection.connected || !connection.appSlug) return null;
		const state = await new SignJWT({ purpose: INSTALL_STATE_PURPOSE, uid, teamId })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('30m')
			.sign(this.stateSecret());
		return `${installUrl(connection.appSlug)}?state=${encodeURIComponent(state)}`;
	}

	async verifyInstallState(state: string): Promise<{ uid: string; teamId: string }> {
		try {
			const { payload } = await jwtVerify(state, this.stateSecret());
			if (payload.purpose !== INSTALL_STATE_PURPOSE) throw new Error('bad purpose');
			if (typeof payload.uid !== 'string' || typeof payload.teamId !== 'string') throw new Error('missing claims');
			return { uid: payload.uid, teamId: payload.teamId };
		} catch {
			throw new ApiError(400, 'invalid_state');
		}
	}

	// Bearer of a valid grant still can't bind for someone else: the console redeems it authenticated and uid must match the claimer.
	signInstallGrant(uid: string, teamId: string, githubInstallationId: string): Promise<string> {
		return new SignJWT({ purpose: INSTALL_GRANT_PURPOSE, uid, teamId, gid: githubInstallationId })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(this.stateSecret());
	}

	async verifyInstallGrant(grant: string): Promise<{ uid: string; teamId: string; githubInstallationId: string }> {
		try {
			const { payload } = await jwtVerify(grant, this.stateSecret());
			if (payload.purpose !== INSTALL_GRANT_PURPOSE) throw new Error('bad purpose');
			if (typeof payload.uid !== 'string' || typeof payload.teamId !== 'string' || typeof payload.gid !== 'string') throw new Error('missing claims');
			return { uid: payload.uid, teamId: payload.teamId, githubInstallationId: payload.gid };
		} catch {
			throw new ApiError(400, 'invalid_grant');
		}
	}

	async getOAuthCredentials(): Promise<{ clientId: string; clientSecret: string }> {
		const row = await this.latestConnectionRow();
		if (!row?.clientId || !row.clientSecretCiphertext) throw new ApiError(400, 'github_oauth_not_configured');
		return { clientId: row.clientId, clientSecret: decryptSecret(row.clientSecretCiphertext) };
	}

	async getWebhookSecret(): Promise<string | null> {
		const row = await this.latestConnectionRow();
		return row ? decryptSecret(row.webhookSecretCiphertext) : null;
	}

	async deleteConnection(): Promise<void> {
		await db.delete(gitAppConnections).where(eq(gitAppConnections.provider, 'github'));
		clearInstallationTokenCache();
	}

	consoleRedirect(query: Record<string, string>): string {
		return consoleGitSettingsUrl(this.config.api.appBaseUrl, query);
	}

	teamSetupRedirect(query: Record<string, string>): string {
		return `${this.config.api.appBaseUrl.replace(/\/+$/, '')}/team/settings?${new URLSearchParams({ tab: 'github', ...query }).toString()}`;
	}
}
