import { and, eq } from 'drizzle-orm';
import { db, gitAppConnections, gitInstallations } from '@kubwave/db';
import { decryptSecret, encryptSecret } from '@kubwave/crypto';
import { errorMessage } from '../../shared/worker-common/errors.js';
import { tokenIsFresh } from './github-app.js';
import { refreshAccessToken } from './gitea-api.js';

interface CachedToken {
	token: string;
	expiresAtMs: number;
}

const cache = new Map<string, CachedToken>();

function expiresAtFromSeconds(expiresIn: number | null): Date | null {
	if (expiresIn == null || expiresIn <= 0) return null;
	return new Date(Date.now() + expiresIn * 1000);
}

export async function getGiteaAccessToken(installationRowId: string): Promise<string> {
	const cached = cache.get(installationRowId);
	if (cached && tokenIsFresh(cached.expiresAtMs, Date.now())) return cached.token;

	const [row] = await db
		.select({
			accessTokenCiphertext: gitInstallations.accessTokenCiphertext,
			refreshTokenCiphertext: gitInstallations.refreshTokenCiphertext,
			tokenExpiresAt: gitInstallations.tokenExpiresAt,
			instanceUrl: gitAppConnections.instanceUrl,
			clientId: gitAppConnections.clientId,
			clientSecretCiphertext: gitAppConnections.clientSecretCiphertext
		})
		.from(gitInstallations)
		.innerJoin(gitAppConnections, eq(gitInstallations.connectionId, gitAppConnections.id))
		.where(and(eq(gitInstallations.id, installationRowId), eq(gitAppConnections.provider, 'gitea')))
		.limit(1);
	if (!row?.accessTokenCiphertext || !row.instanceUrl) {
		throw new Error('Gitea account not found — reconnect it in team settings.');
	}

	const accessToken = decryptSecret(row.accessTokenCiphertext);
	const expiresAtMs = row.tokenExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
	if (tokenIsFresh(expiresAtMs, Date.now()) || !row.refreshTokenCiphertext || !row.clientId || !row.clientSecretCiphertext) {
		cache.set(installationRowId, { token: accessToken, expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 30 * 60_000 });
		return accessToken;
	}

	let refreshed;
	try {
		refreshed = await refreshAccessToken(
			row.instanceUrl,
			row.clientId,
			decryptSecret(row.clientSecretCiphertext),
			decryptSecret(row.refreshTokenCiphertext)
		);
	} catch (err) {
		throw new Error(`Gitea token refresh failed: ${errorMessage(err)}`);
	}

	const nextExpiry = expiresAtFromSeconds(refreshed.expiresIn);
	await db
		.update(gitInstallations)
		.set({
			accessTokenCiphertext: encryptSecret(refreshed.accessToken),
			refreshTokenCiphertext: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : row.refreshTokenCiphertext,
			tokenExpiresAt: nextExpiry,
			updatedAt: new Date()
		})
		.where(eq(gitInstallations.id, installationRowId));

	const nextExpiryMs = nextExpiry?.getTime() ?? Date.now() + 30 * 60_000;
	cache.set(installationRowId, { token: refreshed.accessToken, expiresAtMs: nextExpiryMs });
	return refreshed.accessToken;
}

export function clearGiteaTokenCache(installationRowId?: string): void {
	if (installationRowId) cache.delete(installationRowId);
	else cache.clear();
}

export { expiresAtFromSeconds };
