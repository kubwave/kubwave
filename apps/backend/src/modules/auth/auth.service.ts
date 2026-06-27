import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { db, refreshTokens, users } from '@kubwave/db';
import { TeamsService } from '../teams/teams.service.js';
import { PasswordService } from '../../shared/auth/password.service.js';
import { TokenService } from '../../shared/auth/token.service.js';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { ApiError } from '../../shared/errors/api-error.js';

const REFRESH_REUSE_LEEWAY_MS = 10_000;

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
	constructor(
		private readonly config: BackendConfigService,
		private readonly passwords: PasswordService,
		private readonly teams: TeamsService,
		private readonly tokens: TokenService
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

	private async revokeAllForUser(userId: string): Promise<void> {
		await db
			.update(refreshTokens)
			.set({ revokedAt: new Date() })
			.where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
	}
}
