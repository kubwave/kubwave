import { eq } from 'drizzle-orm';
import { db, gitAppConnections, gitInstallations } from '@kubwave/db';
import { decryptSecret, signJwtRs256 } from '@kubwave/crypto';
import { errorMessage } from '../../shared/worker-common/errors.js';
import { buildAppJwtClaims, tokenIsFresh } from './github-app.js';

const GITHUB_API = 'https://api.github.com';

interface CachedToken {
	token: string;
	expiresAtMs: number;
}

const cache = new Map<string, CachedToken>();

export function signAppJwt(appId: string, privateKeyPem: string): string {
	const nowSeconds = Math.floor(Date.now() / 1000);
	return signJwtRs256({ ...buildAppJwtClaims(appId, nowSeconds) }, privateKeyPem);
}

export async function getInstallationToken(installationRowId: string): Promise<string> {
	const cached = cache.get(installationRowId);
	if (cached && tokenIsFresh(cached.expiresAtMs, Date.now())) return cached.token;

	const [row] = await db
		.select({
			githubInstallationId: gitInstallations.githubInstallationId,
			appId: gitAppConnections.appId,
			privateKeyCiphertext: gitAppConnections.privateKeyCiphertext
		})
		.from(gitInstallations)
		.innerJoin(gitAppConnections, eq(gitInstallations.connectionId, gitAppConnections.id))
		.where(eq(gitInstallations.id, installationRowId))
		.limit(1);
	if (!row) throw new Error('GitHub installation not found — the connection may have been removed. Reconnect it in platform settings.');

	const jwt = signAppJwt(row.appId, decryptSecret(row.privateKeyCiphertext));
	let res: Response;
	try {
		res = await fetch(`${GITHUB_API}/app/installations/${row.githubInstallationId}/access_tokens`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		});
	} catch (err) {
		throw new Error(`GitHub installation-token request failed: ${errorMessage(err)}`);
	}
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`GitHub installation-token request returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
	}
	const json = (await res.json()) as { token?: string; expires_at?: string };
	if (!json.token || !json.expires_at) throw new Error('GitHub installation-token response missing token or expiry.');

	cache.set(installationRowId, { token: json.token, expiresAtMs: Date.parse(json.expires_at) });
	return json.token;
}

// Call on connection/installation teardown so a revoked installation can't keep serving a cached token.
export function clearInstallationTokenCache(installationRowId?: string): void {
	if (installationRowId) cache.delete(installationRowId);
	else cache.clear();
}
