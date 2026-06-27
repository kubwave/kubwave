import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, invitations, users } from '@kubwave/db';
import type { Invitation } from '@kubwave/db';
import { AuthService } from '../auth/auth.service.js';
import type { SessionUser } from '../auth/auth.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { PasswordService } from '../../shared/auth/password.service.js';
import { TokenService } from '../../shared/auth/token.service.js';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { MailerService } from '../../shared/mailer/mailer.service.js';
import type { AcceptInviteInput, CreateInviteInput, InvitationDto, InvitationStatus } from './invitations.dto.js';
import { InviteAlreadyUsedError, InviteEmailInUseError, InviteExpiredError, InviteNotFoundError } from './invitations.errors.js';

export const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface CreateInviteResult {
	invitation: InvitationDto;
	emailSent: boolean;
	emailError?: string;
}

export interface InviteAcceptResult {
	user: SessionUser;
	accessToken: string;
	refreshToken: string;
	activeTeamId: string;
}

function toInvitationView(row: Invitation): InvitationDto {
	const status: InvitationStatus = row.acceptedAt ? 'accepted' : row.expiresAt.getTime() <= Date.now() ? 'expired' : 'pending';

	return {
		id: row.id,
		email: row.email,
		isAdmin: row.isAdmin,
		invitedBy: row.invitedBy,
		expiresAt: row.expiresAt.toISOString(),
		acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
		status
	};
}

function isUniqueViolation(err: unknown): boolean {
	return !!err && typeof err === 'object' && (err as { code?: unknown }).code === '23505';
}

@Injectable()
export class InvitationsService {
	constructor(
		private readonly auth: AuthService,
		private readonly config: BackendConfigService,
		private readonly mailer: MailerService,
		private readonly passwords: PasswordService,
		private readonly teams: TeamsService,
		private readonly tokens: TokenService
	) {}

	async createInvitation(input: CreateInviteInput, invitedByUserId: string): Promise<CreateInviteResult> {
		if (await this.inviteEmailExists(input.email)) throw new InviteEmailInUseError();

		await db.delete(invitations).where(and(eq(invitations.email, input.email), isNull(invitations.acceptedAt)));

		const rawToken = this.tokens.generateRefreshToken();
		const tokenHash = this.tokens.hashRefreshToken(rawToken);
		const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

		const [row] = await db
			.insert(invitations)
			.values({ email: input.email, tokenHash, isAdmin: input.isAdmin, invitedBy: invitedByUserId, expiresAt })
			.returning();

		if (!row) throw new Error('failed to create invitation');

		return this.sendInviteFor(row, rawToken, invitedByUserId);
	}

	async listInvitations(): Promise<InvitationDto[]> {
		const rows = await db.select().from(invitations).orderBy(desc(invitations.createdAt));
		return rows.map(toInvitationView);
	}

	async resendInvitation(id: string): Promise<CreateInviteResult> {
		const [row] = await db.select().from(invitations).where(eq(invitations.id, id)).limit(1);
		if (!row) throw new InviteNotFoundError();
		if (row.acceptedAt) throw new InviteAlreadyUsedError();

		const rawToken = this.tokens.generateRefreshToken();
		const tokenHash = this.tokens.hashRefreshToken(rawToken);
		const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

		const [updated] = await db.update(invitations).set({ tokenHash, expiresAt }).where(eq(invitations.id, id)).returning();
		if (!updated) throw new InviteNotFoundError();

		return this.sendInviteFor(updated, rawToken, updated.invitedBy);
	}

	async revokeInvitation(id: string): Promise<void> {
		const [row] = await db.delete(invitations).where(eq(invitations.id, id)).returning({ id: invitations.id });
		if (!row) throw new InviteNotFoundError();
	}

	async checkInviteValidity(rawToken: string): Promise<{ valid: boolean; email?: string }> {
		try {
			const row = await this.findValidInviteByToken(rawToken);
			return { valid: true, email: row.email };
		} catch {
			return { valid: false };
		}
	}

	async acceptInvitation(input: AcceptInviteInput & { token: string }): Promise<InviteAcceptResult> {
		const invite = await this.findValidInviteByToken(input.token);
		const passwordHash = await this.passwords.hash(input.password);

		const { user, activeTeamId } = await db
			.transaction(async tx => {
				const [existingEmail] = await tx.select({ id: users.id }).from(users).where(eq(users.email, invite.email)).limit(1);
				if (existingEmail) throw new InviteEmailInUseError();

				const [newUser] = await tx
					.insert(users)
					.values({ name: input.name, email: invite.email, password: passwordHash, isAdmin: invite.isAdmin })
					.returning();
				if (!newUser) throw new Error('failed to create user');

				const teamId = await this.teams.createDefaultTeamForUser(newUser.id, tx);
				const [accepted] = await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id)).returning({
					id: invitations.id
				});
				if (!accepted) throw new InviteNotFoundError();

				return { user: newUser, activeTeamId: teamId };
			})
			.catch(err => {
				if (isUniqueViolation(err)) throw new InviteEmailInUseError();
				throw err;
			});

		const accessToken = await this.tokens.signAccessToken(user.id);
		const refreshToken = await this.auth.issueRefreshToken(user.id);

		return {
			user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
			accessToken,
			refreshToken,
			activeTeamId
		};
	}

	private async inviteEmailExists(email: string): Promise<boolean> {
		const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
		return Boolean(existing);
	}

	private async sendInviteFor(row: Invitation, rawToken: string, invitedByUserId: string | null): Promise<CreateInviteResult> {
		let invitedByName: string | null = null;

		if (invitedByUserId) {
			const [inviter] = await db.select({ name: users.name }).from(users).where(eq(users.id, invitedByUserId)).limit(1);
			invitedByName = inviter?.name ?? null;
		}

		const acceptUrl = `${this.config.api.appBaseUrl}/auth/accept?token=${rawToken}`;

		try {
			await this.mailer.sendInviteEmail({ to: row.email, acceptUrl, invitedByName, expiresInDays: INVITE_TTL_DAYS });
			return { invitation: toInvitationView(row), emailSent: true };
		} catch (err) {
			return { invitation: toInvitationView(row), emailSent: false, emailError: err instanceof Error ? err.message : String(err) };
		}
	}

	private async findValidInviteByToken(rawToken: string): Promise<Invitation> {
		const tokenHash = this.tokens.hashRefreshToken(rawToken);
		const [row] = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).limit(1);

		if (!row) throw new InviteNotFoundError();
		if (row.acceptedAt) throw new InviteAlreadyUsedError();
		if (row.expiresAt.getTime() <= Date.now()) throw new InviteExpiredError();

		return row;
	}
}
