import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { db, gitAppConnections } from '@kubwave/db';
import { decryptSecret, encryptSecret, signJwtRs256 } from '@kubwave/crypto';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { buildAppJwtClaims } from './github-app.js';
import { clearInstallationTokenCache } from './installation-token.js';
import { appsNewUrl, buildAppManifest, installUrl, parseManifestConversion } from './git-manifest.js';
import type { GithubConnectionDto, GithubManifestDto } from './git-connection.dto.js';

const STATE_PURPOSE = 'github-app-manifest';
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

	async getConnection(): Promise<GithubConnectionDto> {
		const [row] = await db
			.select()
			.from(gitAppConnections)
			.where(eq(gitAppConnections.provider, 'github'))
			.orderBy(desc(gitAppConnections.createdAt))
			.limit(1);
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
		const [row] = await db
			.select({ id: gitAppConnections.id, appId: gitAppConnections.appId, pem: gitAppConnections.privateKeyCiphertext })
			.from(gitAppConnections)
			.where(eq(gitAppConnections.provider, 'github'))
			.orderBy(desc(gitAppConnections.createdAt))
			.limit(1);
		if (!row) return null;
		const jwt = signJwtRs256({ ...buildAppJwtClaims(row.appId, Math.floor(Date.now() / 1000)) }, decryptSecret(row.pem));
		return { connectionId: row.id, appJwt: jwt };
	}

	async getWebhookSecret(): Promise<string | null> {
		const [row] = await db
			.select({ ct: gitAppConnections.webhookSecretCiphertext })
			.from(gitAppConnections)
			.where(eq(gitAppConnections.provider, 'github'))
			.orderBy(desc(gitAppConnections.createdAt))
			.limit(1);
		return row ? decryptSecret(row.ct) : null;
	}

	async deleteConnection(): Promise<void> {
		await db.delete(gitAppConnections).where(eq(gitAppConnections.provider, 'github'));
		clearInstallationTokenCache();
	}

	consoleRedirect(query: Record<string, string>): string {
		return `${this.config.api.appBaseUrl.replace(/\/+$/, '')}/admin/settings?${new URLSearchParams(query).toString()}`;
	}
}
