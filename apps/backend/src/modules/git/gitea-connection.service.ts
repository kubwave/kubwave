import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { db, gitAppConnections, type GitAppConnection } from '@kubwave/db';
import { decryptSecret, encryptSecret, generatePassword } from '@kubwave/crypto';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { buildAuthorizeUrl, giteaCallbackUrl, giteaWebhookUrl, normalizeInstanceUrl, probeInstance } from './gitea-api.js';
import type { ConnectGiteaInput, GiteaConnectionDto } from './gitea-connection.dto.js';
import { clearGiteaTokenCache } from './gitea-token.js';

const OAUTH_STATE_PURPOSE = 'gitea-oauth';
const OAUTH_GRANT_PURPOSE = 'gitea-oauth-grant';

@Injectable()
export class GiteaConnectionService {
	constructor(private readonly config: BackendConfigService) {}

	private stateSecret(): Uint8Array {
		return new TextEncoder().encode(this.config.api.jwtSecret);
	}

	private async latestConnectionRow(): Promise<GitAppConnection | undefined> {
		const [row] = await db
			.select()
			.from(gitAppConnections)
			.where(eq(gitAppConnections.provider, 'gitea'))
			.orderBy(desc(gitAppConnections.createdAt))
			.limit(1);
		return row;
	}

	async connect(input: ConnectGiteaInput, userId: string): Promise<GiteaConnectionDto> {
		const instanceUrl = normalizeInstanceUrl(input.instanceUrl);
		await probeInstance(instanceUrl);
		const host = new URL(instanceUrl).host;
		await db.transaction(async tx => {
			await tx.delete(gitAppConnections).where(eq(gitAppConnections.provider, 'gitea'));
			await tx.insert(gitAppConnections).values({
				provider: 'gitea',
				appId: input.clientId,
				appSlug: host,
				instanceUrl,
				clientId: input.clientId,
				clientSecretCiphertext: encryptSecret(input.clientSecret),
				privateKeyCiphertext: null,
				webhookSecretCiphertext: encryptSecret(generatePassword()),
				createdByUserId: userId
			});
		});
		clearGiteaTokenCache();
		return this.getConnection();
	}

	async getConnection(): Promise<GiteaConnectionDto> {
		const row = await this.latestConnectionRow();
		const base = this.config.api.appBaseUrl;
		if (!row?.instanceUrl || !row.clientId) {
			return {
				connected: false,
				instanceUrl: null,
				clientId: null,
				callbackUrl: giteaCallbackUrl(base),
				webhookUrl: giteaWebhookUrl(base),
				connectedAt: null
			};
		}
		return {
			connected: true,
			instanceUrl: row.instanceUrl,
			clientId: row.clientId,
			callbackUrl: giteaCallbackUrl(base),
			webhookUrl: giteaWebhookUrl(base),
			connectedAt: row.createdAt.toISOString()
		};
	}

	async getLiveConnection(): Promise<GitAppConnection> {
		const row = await this.latestConnectionRow();
		if (!row?.instanceUrl || !row.clientId || !row.clientSecretCiphertext) throw new ApiError(404, 'no_gitea_connection');
		return row;
	}

	async getOAuthCredentials(): Promise<{ connectionId: string; instanceUrl: string; clientId: string; clientSecret: string }> {
		const row = await this.getLiveConnection();
		return {
			connectionId: row.id,
			instanceUrl: row.instanceUrl!,
			clientId: row.clientId!,
			clientSecret: decryptSecret(row.clientSecretCiphertext!)
		};
	}

	async getWebhookSecret(): Promise<string | null> {
		const row = await this.latestConnectionRow();
		return row ? decryptSecret(row.webhookSecretCiphertext) : null;
	}

	async teamAuthorizeUrl(uid: string, teamId: string): Promise<string | null> {
		const creds = await this.getOAuthCredentials().catch(() => null);
		if (!creds) return null;
		const state = await new SignJWT({ purpose: OAUTH_STATE_PURPOSE, uid, teamId })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('30m')
			.sign(this.stateSecret());
		return buildAuthorizeUrl(creds.instanceUrl, creds.clientId, giteaCallbackUrl(this.config.api.appBaseUrl), state);
	}

	async verifyOAuthState(state: string): Promise<{ uid: string; teamId: string }> {
		try {
			const { payload } = await jwtVerify(state, this.stateSecret());
			if (payload.purpose !== OAUTH_STATE_PURPOSE) throw new Error('bad purpose');
			if (typeof payload.uid !== 'string' || typeof payload.teamId !== 'string') throw new Error('missing claims');
			return { uid: payload.uid, teamId: payload.teamId };
		} catch {
			throw new ApiError(400, 'invalid_state');
		}
	}

	signOAuthGrant(uid: string, teamId: string, pendingId: string): Promise<string> {
		return new SignJWT({ purpose: OAUTH_GRANT_PURPOSE, uid, teamId, pid: pendingId })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(this.stateSecret());
	}

	async verifyOAuthGrant(grant: string): Promise<{ uid: string; teamId: string; pendingId: string }> {
		try {
			const { payload } = await jwtVerify(grant, this.stateSecret());
			if (payload.purpose !== OAUTH_GRANT_PURPOSE) throw new Error('bad purpose');
			if (typeof payload.uid !== 'string' || typeof payload.teamId !== 'string' || typeof payload.pid !== 'string') throw new Error('missing claims');
			return { uid: payload.uid, teamId: payload.teamId, pendingId: payload.pid };
		} catch {
			throw new ApiError(400, 'invalid_grant');
		}
	}

	async deleteConnection(): Promise<void> {
		await db.delete(gitAppConnections).where(eq(gitAppConnections.provider, 'gitea'));
		clearGiteaTokenCache();
	}

	teamSetupRedirect(query: Record<string, string>): string {
		return `${this.config.api.appBaseUrl.replace(/\/+$/, '')}/team/settings?${new URLSearchParams({ tab: 'gitea', ...query }).toString()}`;
	}
}
