import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, gitInstallations, gitRepositories, services, type GitInstallation } from '@kubwave/db';
import { ApiError } from '../../shared/errors/api-error.js';
import { TeamsService } from '../teams/teams.service.js';
import { GitConnectionService } from './git-connection.service.js';
import { exchangeOAuthCode, getAppInstallation, listInstallationRepos, listUserInstallationIds } from './github-api.js';
import { clearInstallationTokenCache, getInstallationToken } from './installation-token.js';
import type { GitInstallationDto, GitRepositoryDto } from './git-repos.dto.js';
import type { WebhookAction, WebhookRepo } from './github-webhook.js';

function toInstallationView(row: GitInstallation): GitInstallationDto {
	return {
		id: row.id,
		githubInstallationId: row.githubInstallationId,
		accountLogin: row.accountLogin,
		accountType: row.accountType,
		suspended: row.suspendedAt !== null,
		createdAt: row.createdAt.toISOString()
	};
}

@Injectable()
export class GitInstallationsService {
	constructor(
		private readonly teams: TeamsService,
		private readonly connections: GitConnectionService
	) {}

	// Bind a GitHub installation to a team: validate it belongs to our App (App-JWT call), upsert the row, then mirror its repos.
	async bindInstallation(userId: string, teamId: string, githubInstallationId: string): Promise<GitInstallationDto> {
		await this.teams.requireTeamRole(userId, teamId, 'owner');
		// A caller-supplied id isn't proof the caller controls the installation; re-pointing one another team holds would leak its
		// private repos + tokens. Reject rather than re-point — the current owner must unbind first.
		const existing = await this.findByGithubId(githubInstallationId);
		if (existing && existing.teamId !== teamId) throw new ApiError(409, 'installation_bound_to_another_team');
		const ctx = await this.connections.getAppContext();
		if (!ctx) throw new ApiError(404, 'no_github_connection');
		const account = await getAppInstallation(ctx.appJwt, githubInstallationId);

		const [row] = await db
			.insert(gitInstallations)
			.values({
				connectionId: ctx.connectionId,
				githubInstallationId,
				accountLogin: account.accountLogin,
				accountType: account.accountType,
				teamId
			})
			// setWhere pins the update to the owning team, closing the TOCTOU race: a conflicting row owned by another team is left
			// untouched, RETURNING yields nothing, and the `!row` check below rejects.
			.onConflictDoUpdate({
				target: [gitInstallations.connectionId, gitInstallations.githubInstallationId],
				set: { accountLogin: account.accountLogin, accountType: account.accountType, suspendedAt: null, updatedAt: new Date() },
				setWhere: eq(gitInstallations.teamId, teamId)
			})
			.returning();
		if (!row) throw new ApiError(409, 'installation_bound_to_another_team');
		await this.syncRepos(row.id);
		return toInstallationView(row);
	}

	async listForTeam(userId: string, teamId: string): Promise<GitInstallationDto[]> {
		await this.teams.requireTeamRole(userId, teamId, 'member');
		const rows = await db.select().from(gitInstallations).where(eq(gitInstallations.teamId, teamId)).orderBy(desc(gitInstallations.createdAt));
		return rows.map(toInstallationView);
	}

	async teamConnection(userId: string, teamId: string): Promise<{ connected: boolean; installUrl: string | null }> {
		await this.teams.requireTeamRole(userId, teamId, 'member');
		const conn = await this.connections.getConnection();
		if (!conn.connected) return { connected: false, installUrl: null };
		return { connected: true, installUrl: await this.connections.teamInstallUrl(userId, teamId) };
	}

	// Prove the code-derived user owns the install, then hand back a grant. Binding waits for the console to redeem it authenticated, so a
	// phished victim who merely completes the install can't have it bound to the attacker's team (the redeem step re-checks the claimer's uid).
	async completeInstall(githubInstallationId: string, code: string, state: string): Promise<string> {
		const { uid, teamId } = await this.connections.verifyInstallState(state);
		const creds = await this.connections.getOAuthCredentials();
		const userToken = await exchangeOAuthCode(creds.clientId, creds.clientSecret, code);
		const owned = await listUserInstallationIds(userToken);
		if (!owned.has(githubInstallationId)) throw new ApiError(403, 'installation_not_owned');
		return this.connections.signInstallGrant(uid, teamId, githubInstallationId);
	}

	async claimInstallation(userId: string, teamId: string, grant: string): Promise<GitInstallationDto> {
		const g = await this.connections.verifyInstallGrant(grant);
		if (g.uid !== userId || g.teamId !== teamId) throw new ApiError(403, 'grant_mismatch');
		return this.bindInstallation(g.uid, g.teamId, g.githubInstallationId);
	}

	async listRepos(userId: string, teamId: string, installationRowId: string): Promise<GitRepositoryDto[]> {
		await this.teams.requireTeamRole(userId, teamId, 'member');
		const row = await this.requireTeamInstallation(teamId, installationRowId);
		return this.readRepos(row.id);
	}

	// Manual repo sync for envs GitHub can't reach: on localhost/private the `installation_repositories` webhook never arrives.
	async resyncRepos(userId: string, teamId: string, installationRowId: string): Promise<GitRepositoryDto[]> {
		await this.teams.requireTeamRole(userId, teamId, 'member');
		const row = await this.requireTeamInstallation(teamId, installationRowId);
		await this.syncRepos(row.id);
		return this.readRepos(row.id);
	}

	private async readRepos(installationRowId: string): Promise<GitRepositoryDto[]> {
		const rows = await db
			.select()
			.from(gitRepositories)
			.where(eq(gitRepositories.installationId, installationRowId))
			.orderBy(asc(gitRepositories.repoFullName));
		return rows.map(r => ({ repoFullName: r.repoFullName, defaultBranch: r.defaultBranch, isPrivate: r.isPrivate }));
	}

	async unbind(userId: string, teamId: string, installationRowId: string): Promise<void> {
		await this.teams.requireTeamRole(userId, teamId, 'owner');
		const row = await this.requireTeamInstallation(teamId, installationRowId);
		await db.delete(gitInstallations).where(eq(gitInstallations.id, row.id));
		clearInstallationTokenCache(row.id);
	}

	private async requireTeamInstallation(teamId: string, installationRowId: string): Promise<GitInstallation> {
		const [row] = await db
			.select()
			.from(gitInstallations)
			.where(and(eq(gitInstallations.id, installationRowId), eq(gitInstallations.teamId, teamId)))
			.limit(1);
		if (!row) throw new ApiError(404, 'installation_not_found');
		return row;
	}

	// Replace the repo mirror with a fresh listing from GitHub, so a full sync corrects any drift left by webhook-only updates.
	private async syncRepos(installationRowId: string): Promise<void> {
		const token = await getInstallationToken(installationRowId);
		const repos = await listInstallationRepos(token);
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

	private findByGithubId(githubInstallationId: string): Promise<GitInstallation | undefined> {
		return db
			.select()
			.from(gitInstallations)
			.where(eq(gitInstallations.githubInstallationId, githubInstallationId))
			.limit(1)
			.then(rows => rows[0]);
	}

	async upsertRepos(installationRowId: string, repos: WebhookRepo[]): Promise<void> {
		if (repos.length === 0) return;
		await db
			.insert(gitRepositories)
			.values(repos.map(r => ({ installationId: installationRowId, repoFullName: r.fullName, isPrivate: r.isPrivate, lastSyncedAt: new Date() })))
			.onConflictDoUpdate({
				target: [gitRepositories.installationId, gitRepositories.repoFullName],
				set: { isPrivate: sql`excluded.is_private`, lastSyncedAt: new Date() }
			});
	}

	// Apply a parsed webhook to the mirror. Events for an installation we haven't bound to a team yet are no-ops — the setup redirect creates and syncs it.
	async applyWebhookAction(action: WebhookAction): Promise<void> {
		switch (action.kind) {
			case 'ignored':
				return;
			case 'installation-deleted': {
				const row = await this.findByGithubId(action.githubInstallationId);
				if (!row) return;
				await db.delete(gitInstallations).where(eq(gitInstallations.id, row.id));
				clearInstallationTokenCache(row.id);
				return;
			}
			case 'installation-suspended': {
				await db
					.update(gitInstallations)
					.set({ suspendedAt: action.suspended ? new Date() : null, updatedAt: new Date() })
					.where(eq(gitInstallations.githubInstallationId, action.githubInstallationId));
				return;
			}
			case 'repos-added': {
				const row = await this.findByGithubId(action.githubInstallationId);
				if (row) await this.upsertRepos(row.id, action.repos);
				return;
			}
			case 'repos-removed': {
				const row = await this.findByGithubId(action.githubInstallationId);
				if (!row || action.repoFullNames.length === 0) return;
				await db
					.delete(gitRepositories)
					.where(and(eq(gitRepositories.installationId, row.id), inArray(gitRepositories.repoFullName, action.repoFullNames)));
				return;
			}
			case 'push': {
				const row = await this.findByGithubId(action.githubInstallationId);
				if (!row) return;
				// Nudge the poller instead of enqueuing here: it re-verifies HEAD and dedups by SHA, so a webhook + a poll can't double-deploy.
				await db
					.update(services)
					.set({ nextPollAt: new Date() })
					.where(
						and(
							eq(services.type, 'github-repo'),
							eq(services.autoDeployEnabled, true),
							sql`${services.config}->>'installationId' = ${row.id}`,
							sql`${services.config}->>'repoFullName' = ${action.repoFullName}`,
							sql`${services.config}->>'branch' = ${action.branch}`
						)
					);
				return;
			}
		}
	}
}
