import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { db, passwordResetTokens, refreshTokens, users } from '@kubwave/db';
import { TeamsService } from '../teams/teams.service.js';
import { PasswordService } from '../../shared/auth/password.service.js';
import { TokenService } from '../../shared/auth/token.service.js';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { MailerService } from '../../shared/mailer/mailer.service.js';

const REFRESH_REUSE_LEEWAY_MS = 10_000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface SessionUser {
	id: string;
	name: string;
	email: string;
	isAdmin: boolean;
}

export interface LoginResult {
	user: SessionUser;
	accessToken: string;
	refreshToken: string;
	activeTeamId: string | null;
}

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

	constructor(
		private readonly config: BackendConfigService,
		private readonly passwords: PasswordService,
		private readonly teams: TeamsService,
		private readonly tokens: TokenService,
		private readonly mailer: MailerService
	) {}

	async loginWithPassword(email: string, password: string): Promise<LoginResult> {
		const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
		if (!user || !(await this.passwords.verify(user.password, password))) {
			throw new ApiError(401, 'invalid_credentials');
		}

		const activeTeamId = await this.teams.firstTeamIdForUser(user.id);
		return {
			user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
			accessToken: await this.tokens.signAccessToken(user.id),
			refreshToken: await this.issueRefreshToken(user.id),
			activeTeamId
		};
	}

	async getSessionUser(userId: string): Promise<SessionUser> {
		const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
		if (!user) throw new ApiError(401, 'unauthorized');
		return { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin };
	}

	async rotateRefreshToken(presented: string): Promise<{ accessToken: string; refreshToken: string }> {
		const tokenHash = this.tokens.hashRefreshToken(presented);
		const [record] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);
		if (!record) throw new ApiError(401, 'unauthorized');

		if (record.revokedAt) {
			if (Date.now() - record.revokedAt.getTime() <= REFRESH_REUSE_LEEWAY_MS) {
				return {
					accessToken: await this.tokens.signAccessToken(record.userId),
					refreshToken: await this.issueRefreshToken(record.userId)
				};
			}
			await this.revokeAllForUser(record.userId);
			throw new ApiError(401, 'unauthorized');
		}

		if (record.expiresAt.getTime() <= Date.now()) throw new ApiError(401, 'unauthorized');

		await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, record.id));
		return {
			accessToken: await this.tokens.signAccessToken(record.userId),
			refreshToken: await this.issueRefreshToken(record.userId)
		};
	}

	async revokeRefreshToken(presented: string): Promise<void> {
		const tokenHash = this.tokens.hashRefreshToken(presented);
		await db
			.update(refreshTokens)
			.set({ revokedAt: new Date() })
			.where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
	}

	async issueRefreshToken(userId: string): Promise<string> {
		const token = this.tokens.generateRefreshToken();
		await db.insert(refreshTokens).values({
			userId,
			tokenHash: this.tokens.hashRefreshToken(token),
			expiresAt: new Date(Date.now() + this.config.api.refreshTtlSec * 1000)
		});
		return token;
	}

	async requestPasswordReset(email: string): Promise<void> {
		try {
			const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
			if (!user) return;

			await db.delete(passwordResetTokens).where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

			const rawToken = this.tokens.generateRefreshToken();
			const tokenHash = this.tokens.hashRefreshToken(rawToken);
			const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
			await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt });

			const resetUrl = `${this.config.api.appBaseUrl}/auth/reset?token=${rawToken}`;
			// Don't await the SMTP round-trip — keeps response time independent of email delivery.
			// Trade-off: at-most-once delivery (a send in flight is lost on shutdown).
			void this.mailer
				.sendPasswordResetEmail({ to: user.email, resetUrl, expiresInMinutes: PASSWORD_RESET_TTL_MS / 60_000 })
				.catch(err => this.logger.debug(`Password reset email not sent: ${err instanceof Error ? err.message : String(err)}`));
		} catch (err) {
			// Swallow + log so the response is identical (and timing-independent) whether or not
			// the account exists or infra fails — never leak via the response.
			this.logger.error('Failed to process password reset request', err instanceof Error ? err.stack : String(err));
		}
	}

	private isResetTokenValid(record: { usedAt: Date | null; expiresAt: Date } | undefined): boolean {
		return Boolean(record && !record.usedAt && record.expiresAt.getTime() > Date.now());
	}

	async resetPassword(rawToken: string, password: string): Promise<void> {
		const tokenHash = this.tokens.hashRefreshToken(rawToken);
		const [record] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
		if (!record || !this.isResetTokenValid(record)) {
			throw new ApiError(400, 'invalid_reset_token');
		}

		const passwordHash = await this.passwords.hash(password);
		await db.transaction(async tx => {
			await tx.update(users).set({ password: passwordHash, updatedAt: new Date() }).where(eq(users.id, record.userId));
			await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));
			await tx
				.update(refreshTokens)
				.set({ revokedAt: new Date() })
				.where(and(eq(refreshTokens.userId, record.userId), isNull(refreshTokens.revokedAt)));
		});
	}

	async checkResetTokenValidity(rawToken: string): Promise<{ valid: boolean }> {
		const tokenHash = this.tokens.hashRefreshToken(rawToken);
		const [record] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
		return { valid: this.isResetTokenValid(record) };
	}

	private async revokeAllForUser(userId: string): Promise<void> {
		await db
			.update(refreshTokens)
			.set({ revokedAt: new Date() })
			.where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
	}
}
