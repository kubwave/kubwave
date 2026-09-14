import { eq } from 'drizzle-orm';
import { db, gitAppConnections, gitInstallations } from '@kubwave/db';
import { basicAuthHeader, giteaTokenAuthHeader } from './git-clone-auth.js';
import { getGiteaAccessToken } from './gitea-token.js';
import { getInstallationToken } from './installation-token.js';

export async function getCloneAuthHeader(installationRowId: string): Promise<string> {
	const [row] = await db
		.select({ provider: gitAppConnections.provider })
		.from(gitInstallations)
		.innerJoin(gitAppConnections, eq(gitInstallations.connectionId, gitAppConnections.id))
		.where(eq(gitInstallations.id, installationRowId))
		.limit(1);
	if (!row) throw new Error('Git installation not found — the connection may have been removed. Reconnect it in platform settings.');
	if (row.provider === 'gitea') return giteaTokenAuthHeader(await getGiteaAccessToken(installationRowId));
	return basicAuthHeader(await getInstallationToken(installationRowId));
}
