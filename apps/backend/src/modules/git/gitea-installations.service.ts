import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, gitAppConnections, gitInstallations, gitOauthPending, gitRepositories, services, type GitInstallation } from '@kubwave/db';
import { encryptSecret } from '@kubwave/crypto';
import { ApiError } from '../../shared/errors/api-error.js';
import { TeamsService } from '../teams/teams.service.js';
import { createRepoHook, exchangeOAuthCode, giteaCallbackUrl, giteaWebhookUrl, getAuthenticatedUser, listUserRepos } from './gitea-api.js';
import { GiteaConnectionService } from './gitea-connection.service.js';
import type { GiteaAccountDto, TeamGiteaConnectionDto } from './gitea-connection.dto.js';
import type { GitRepositoryDto } from './git-repos.dto.js';
import { clearGiteaTokenCache, expiresAtFromSeconds, getGiteaAccessToken } from './gitea-token.js';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';

function toAccountView(row: GitInstallation): GiteaAccountDto {
	return {
		id: row.id,
		giteaUserId: row.githubInstallationId,
		accountLogin: row.accountLogin,
		accountType: row.accountType,
		createdAt: row.createdAt.toISOString()
	};
}

@Injectable()
export class GiteaInstallationsService {
	constructor(
		private readonly teams: TeamsService,
		private readonly connections: GiteaConnectionService,
		private readonly config: BackendConfigService
	) {}

	async teamConnection(userId: string, teamId: string): Promise<TeamGiteaConnectionDto> {
		await this.teams.requireTeamRole(userId, teamId, 'member');
		const conn = await this.connections.getConnection();
		if (!conn.connected) return { connected: false, authorizeUrl: null };
		return { connected: true, authorizeUrl: await this.connections.teamAuthorizeUrl(userId, teamId) };
	}

	async completeOAuth(code: string, state: string): Promise<string> {
		const { uid, teamId } = await this.connections.verifyOAuthState(state);
		const creds = await this.connections.getOAuthCredentials();
		const tokens = await exchangeOAuthCode(creds.instanceUrl, creds.clientId, creds.clientSecret, code, giteaCallbackUrl(this.config.api.appBaseUrl));
		const user = await getAuthenticatedUser(creds.instanceUrl, tokens.accessToken);
		const [pending] = await db
			.insert(gitOauthPending)
			.values({
				connectionId: creds.connectionId,
				userId: uid,
				teamId,
				externalId: user.id,
				accountLogin: user.login,
				accessTokenCiphertext: encryptSecret(tokens.accessToken),
				refreshTokenCiphertext: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
				tokenExpiresAt: expiresAtFromSeconds(tokens.expiresIn),
				expiresAt: new Date(Date.now() + 5 * 60_000)
			})
			.returning();
		if (!pending) throw new ApiError(500, 'gitea_oauth_error');
		return this.connections.signOAuthGrant(uid, teamId, pending.id);
	}

	async claimAccount(userId: string, teamId: string, grant: string): Promise<GiteaAccountDto> {
		const g = await this.connections.verifyOAuthGrant(grant);
		if (g.uid !== userId || g.teamId !== teamId) throw new ApiError(403, 'grant_mismatch');
		await this.teams.requireTeamRole(userId, teamId, 'owner');

		const [pending] = await db.select().from(gitOauthPending).where(eq(gitOauthPending.id, g.pendingId)).limit(1);
		if (!pending || pending.expiresAt.getTime() <= Date.now()) throw new ApiError(400, 'invalid_grant');
		if (pending.userId !== userId || pending.teamId !== teamId) throw new ApiError(403, 'grant_mismatch');

		const existing = await this.findByExternalId(pending.connectionId, pending.externalId);
		if (existing && existing.teamId !== teamId) throw new ApiError(409, 'installation_bound_to_another_team');

		const [row] = await db
			.insert(gitInstallations)
			.values({
				connectionId: pending.connectionId,
				githubInstallationId: pending.externalId,
				accountLogin: pending.accountLogin,
				accountType: 'User',
				teamId,
				accessTokenCiphertext: pending.accessTokenCiphertext,
				refreshTokenCiphertext: pending.refreshTokenCiphertext,
				tokenExpiresAt: pending.tokenExpiresAt
			})
			.onConflictDoUpdate({
				target: [gitInstallations.connectionId, gitInstallations.githubInstallationId],
				set: {
					accountLogin: pending.accountLogin,
					accessTokenCiphertext: pending.accessTokenCiphertext,
					refreshTokenCiphertext: pending.refreshTokenCiphertext,
					tokenExpiresAt: pending.tokenExpiresAt,
					suspendedAt: null,
					updatedAt: new Date()
				},
				setWhere: eq(gitInstallations.teamId, teamId)
			})
			.returning();
		if (!row) throw new ApiError(409, 'installation_bound_to_another_team');
		await db.delete(gitOauthPending).where(eq(gitOauthPending.id, pending.id));
		clearGiteaTokenCache(row.id);
		await this.syncRepos(row.id);
		return toAccountView(row);
	}

	async listForTeam(userId: string, teamId: string): Promise<GiteaAccountDto[]> {
		await this.teams.requireTeamRole(userId, teamId, 'member');
		const rows = await db
			.select({ installation: gitInstallations })
			.from(gitInstallations)
			.innerJoin(gitAppConnections, eq(gitInstallations.connectionId, gitAppConnections.id))
			.where(and(eq(gitInstallations.teamId, teamId), eq(gitAppConnections.provider, 'gitea')))
			.orderBy(desc(gitInstallations.createdAt));
		return rows.map(r => toAccountView(r.installation));
	}

	async listRepos(userId: string, teamId: string, installationRowId: string): Promise<GitRepositoryDto[]> {
		await this.teams.requireTeamRole(userId, teamId, 'member');
		const row = await this.requireTeamInstallation(teamId, installationRowId);
		return this.readRepos(row.id);
	}

	async resyncRepos(userId: string, teamId: string, installationRowId: string): Promise<GitRepositoryDto[]> {
		await this.teams.requireTeamRole(userId, teamId, 'member');
		const row = await this.requireTeamInstallation(teamId, installationRowId);
		await this.syncRepos(row.id);
		return this.readRepos(row.id);
	}

	async unbind(userId: string, teamId: string, installationRowId: string): Promise<void> {
		await this.teams.requireTeamRole(userId, teamId, 'owner');
		const row = await this.requireTeamInstallation(teamId, installationRowId);
		await db.delete(gitInstallations).where(eq(gitInstallations.id, row.id));
		clearGiteaTokenCache(row.id);
	}

	async instanceUrlForInstallation(teamId: string, installationRowId: string): Promise<string> {
		const [row] = await db
			.select({ instanceUrl: gitAppConnections.instanceUrl })
			.from(gitInstallations)
			.innerJoin(gitAppConnections, eq(gitInstallations.connectionId, gitAppConnections.id))
			.where(and(eq(gitInstallations.id, installationRowId), eq(gitInstallations.teamId, teamId), eq(gitAppConnections.provider, 'gitea')))
			.limit(1);
		if (!row?.instanceUrl) throw new ApiError(404, 'installation_not_found');
		return row.instanceUrl;
	}

	async tryRegisterRepoHook(installationRowId: string, repoFullName: string): Promise<void> {
		try {
			const creds = await this.connections.getOAuthCredentials();
			const token = await getGiteaAccessToken(installationRowId);
			const secret = await this.connections.getWebhookSecret();
			if (!secret) return;
			await createRepoHook(creds.instanceUrl, token, repoFullName, giteaWebhookUrl(this.config.api.appBaseUrl), secret);
		} catch {
			// Polling still auto-deploys when the token can't create hooks.
		}
	}

	async applyPush(repoFullName: string, branch: string): Promise<void> {
		await db
			.update(services)
			.set({ nextPollAt: new Date() })
			.where(
				and(
					eq(services.type, 'gitea-repo'),
					eq(services.autoDeployEnabled, true),
					sql`${services.config}->>'repoFullName' = ${repoFullName}`,
					sql`${services.config}->>'branch' = ${branch}`
				)
			);
	}

	private async readRepos(installationRowId: string): Promise<GitRepositoryDto[]> {
		const rows = await db
			.select()
			.from(gitRepositories)
			.where(eq(gitRepositories.installationId, installationRowId))
			.orderBy(asc(gitRepositories.repoFullName));
		return rows.map(r => ({ repoFullName: r.repoFullName, defaultBranch: r.defaultBranch, isPrivate: r.isPrivate }));
	}

	private async syncRepos(installationRowId: string): Promise<void> {
		const [conn] = await db
			.select({ instanceUrl: gitAppConnections.instanceUrl })
			.from(gitInstallations)
			.innerJoin(gitAppConnections, eq(gitInstallations.connectionId, gitAppConnections.id))
			.where(eq(gitInstallations.id, installationRowId))
			.limit(1);
		if (!conn?.instanceUrl) return;
		const token = await getGiteaAccessToken(installationRowId);
		const repos = await listUserRepos(conn.instanceUrl, token);
		await db.transaction(async tx => {
			await tx.delete(gitRepositories).where(eq(gitRepositories.installationId, installationRowId));
			if (repos.length > 0) {
				await tx.insert(gitRepositories).values(
					repos.map(r => ({
						installationId: installationRowId,
						repoFullName: r.fullName,
						defaultBranch: r.defaultBranch,
						isPrivate: r.isPrivate,
						lastSyncedAt: new Date()
					}))
				);
			}
		});
	}

	private async requireTeamInstallation(teamId: string, installationRowId: string): Promise<GitInstallation> {
		const [row] = await db
			.select({ installation: gitInstallations })
			.from(gitInstallations)
			.innerJoin(gitAppConnections, eq(gitInstallations.connectionId, gitAppConnections.id))
			.where(and(eq(gitInstallations.id, installationRowId), eq(gitInstallations.teamId, teamId), eq(gitAppConnections.provider, 'gitea')))
			.limit(1);
		if (!row) throw new ApiError(404, 'installation_not_found');
		return row.installation;
	}

	private findByExternalId(connectionId: string, externalId: string): Promise<GitInstallation | undefined> {
		return db
			.select()
			.from(gitInstallations)
			.where(and(eq(gitInstallations.connectionId, connectionId), eq(gitInstallations.githubInstallationId, externalId)))
			.limit(1)
			.then(rows => rows[0]);
	}
}
