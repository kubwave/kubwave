import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db, users } from '@kubwave/db';
import { PasswordService } from '../../shared/auth/password.service.js';
import { TokenService } from '../../shared/auth/token.service.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { AuthService } from '../auth/auth.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { RegistryStatusService } from './registry-status.service.js';
import type { SetupInitializeInput } from './setup.dto.js';

@Injectable()
export class SetupService {
	constructor(
		private readonly auth: AuthService,
		private readonly passwords: PasswordService,
		private readonly registry: RegistryStatusService,
		private readonly teams: TeamsService,
		private readonly tokens: TokenService
	) {}

	async status(): Promise<{ initialized: boolean; registryConfigured: boolean }> {
		const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).limit(1);
		return { initialized: Boolean(admin), registryConfigured: admin ? await this.registry.isConfigured() : false };
	}

	async initialize(input: SetupInitializeInput) {
		const [existingAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).limit(1);
		if (existingAdmin) throw new ApiError(409, 'already_initialized');

		const [existingEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
		if (existingEmail) throw new ApiError(409, 'email_in_use');

		const passwordHash = await this.passwords.hash(input.password);
		const { user, activeTeamId } = await db.transaction(async tx => {
			const [user] = await tx.insert(users).values({ name: input.name, email: input.email, password: passwordHash, isAdmin: true }).returning();

			if (!user) throw new Error('failed to create admin user');
			return { user, activeTeamId: await this.teams.createDefaultTeamForUser(user.id, tx) };
		});

		return {
			user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
			accessToken: await this.tokens.signAccessToken(user.id),
			refreshToken: await this.auth.issueRefreshToken(user.id),
			activeTeamId
		};
	}
}
