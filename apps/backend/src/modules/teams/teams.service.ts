import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { db, teamMembers, teams, users } from '@kubwave/db';
import {
	AlreadyMemberError,
	LastOwnerError,
	MemberNotFoundError,
	TeamForbiddenError,
	TeamNotFoundError,
	TeamUserNotFoundError
} from './teams.errors.js';

export interface TeamView {
	id: string;
	name: string;
	role: 'owner' | 'member';
	isDefault: boolean;
	joinedAt: string;
}

export interface TeamMemberView {
	userId: string;
	name: string;
	email: string;
	role: 'owner' | 'member';
	joinedAt: string;
}

export interface TeamState {
	teams: TeamView[];
	activeTeamId: string | null;
}

type TeamWriteDb = Pick<typeof db, 'insert' | 'select'>;

const DEFAULT_TEAM_NAME = 'Default Team';

function toTeamView(
	row: { id: string; name: string; role: 'owner' | 'member'; defaultForUserId: string | null; joinedAt: Date },
	userId: string
): TeamView {
	return {
		id: row.id,
		name: row.name,
		role: row.role,
		isDefault: row.defaultForUserId === userId,
		joinedAt: row.joinedAt.toISOString()
	};
}

function toMemberView(row: { userId: string; name: string; email: string; role: 'owner' | 'member'; joinedAt: Date }): TeamMemberView {
	return {
		userId: row.userId,
		name: row.name,
		email: row.email,
		role: row.role,
		joinedAt: row.joinedAt.toISOString()
	};
}

@Injectable()
export class TeamsService {
	async createDefaultTeamForUser(userId: string, database: TeamWriteDb = db): Promise<string> {
		const [team] = await database
			.insert(teams)
			.values({
				name: DEFAULT_TEAM_NAME,
				defaultForUserId: userId,
				createdByUserId: userId
			})
			.onConflictDoNothing({ target: teams.defaultForUserId })
			.returning({ id: teams.id });

		if (team) {
			await database.insert(teamMembers).values({ teamId: team.id, userId, role: 'owner' }).onConflictDoNothing();
			return team.id;
		}

		const [existing] = await database.select({ id: teams.id }).from(teams).where(eq(teams.defaultForUserId, userId)).limit(1);
		if (!existing) throw new Error('failed to create default team');

		await database.insert(teamMembers).values({ teamId: existing.id, userId, role: 'owner' }).onConflictDoNothing();
		return existing.id;
	}

	async firstTeamIdForUser(userId: string): Promise<string | null> {
		const [row] = await db
			.select({ id: teamMembers.teamId })
			.from(teamMembers)
			.where(eq(teamMembers.userId, userId))
			.orderBy(asc(teamMembers.createdAt), asc(teamMembers.teamId))
			.limit(1);

		return row?.id ?? null;
	}

	async getTeamState(userId: string, requestedActiveTeamId?: string): Promise<TeamState> {
		const userTeams = await this.listTeamsForUser(userId);

		const activeTeam = requestedActiveTeamId ? userTeams.find(team => team.id === requestedActiveTeamId) : null;
		return {
			teams: userTeams,
			activeTeamId: activeTeam?.id ?? userTeams[0]?.id ?? null
		};
	}

	async listTeamsForUser(userId: string): Promise<TeamView[]> {
		const rows = await db
			.select({
				id: teams.id,
				name: teams.name,
				role: teamMembers.role,
				defaultForUserId: teams.defaultForUserId,
				joinedAt: teamMembers.createdAt
			})
			.from(teamMembers)
			.innerJoin(teams, eq(teamMembers.teamId, teams.id))
			.where(eq(teamMembers.userId, userId))
			.orderBy(asc(teamMembers.createdAt), asc(teamMembers.teamId));

		return rows.map(row => toTeamView(row, userId));
	}

	async setActiveTeamForUser(userId: string, teamId: string): Promise<TeamView> {
		const view = await this.loadTeamView(userId, teamId);
		if (!view) throw new TeamNotFoundError();
		return view;
	}

	async createTeam(actingUserId: string, name: string): Promise<TeamView> {
		return db.transaction(async tx => {
			const [team] = await tx
				.insert(teams)
				.values({ name: name.trim(), createdByUserId: actingUserId, defaultForUserId: null })
				.returning({ id: teams.id, name: teams.name, defaultForUserId: teams.defaultForUserId });

			if (!team) throw new Error('failed to create team');

			const [membership] = await tx
				.insert(teamMembers)
				.values({ teamId: team.id, userId: actingUserId, role: 'owner' })
				.returning({ createdAt: teamMembers.createdAt });

			return toTeamView(
				{ id: team.id, name: team.name, role: 'owner', defaultForUserId: team.defaultForUserId, joinedAt: membership?.createdAt ?? new Date() },
				actingUserId
			);
		});
	}

	async renameTeam(actingUserId: string, teamId: string, name: string): Promise<TeamView> {
		await this.requireTeamRole(actingUserId, teamId, 'owner');
		await db.update(teams).set({ name: name.trim(), updatedAt: new Date() }).where(eq(teams.id, teamId));

		const view = await this.loadTeamView(actingUserId, teamId);
		if (!view) throw new TeamNotFoundError();
		return view;
	}

	async deleteTeam(actingUserId: string, teamId: string): Promise<void> {
		await this.requireTeamRole(actingUserId, teamId, 'owner');
		await db.delete(teams).where(eq(teams.id, teamId));
	}

	async listTeamMembers(actingUserId: string, teamId: string): Promise<TeamMemberView[]> {
		await this.requireTeamRole(actingUserId, teamId, 'member');

		const rows = await db
			.select({
				userId: users.id,
				name: users.name,
				email: users.email,
				role: teamMembers.role,
				joinedAt: teamMembers.createdAt
			})
			.from(teamMembers)
			.innerJoin(users, eq(teamMembers.userId, users.id))
			.where(eq(teamMembers.teamId, teamId))
			.orderBy(sql`case when ${teamMembers.role} = 'owner' then 0 else 1 end`, asc(teamMembers.createdAt));

		return rows.map(toMemberView);
	}

	async addTeamMember(actingUserId: string, teamId: string, email: string): Promise<TeamMemberView> {
		await this.requireTeamRole(actingUserId, teamId, 'owner');

		const [user] = await db
			.select({ id: users.id, name: users.name, email: users.email })
			.from(users)
			.where(sql`lower(${users.email}) = lower(${email})`)
			.limit(1);
		if (!user) throw new TeamUserNotFoundError();

		const [existing] = await db
			.select({ userId: teamMembers.userId })
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))
			.limit(1);
		if (existing) throw new AlreadyMemberError();

		const [membership] = await db
			.insert(teamMembers)
			.values({ teamId, userId: user.id, role: 'member' })
			.returning({ createdAt: teamMembers.createdAt });

		return toMemberView({ userId: user.id, name: user.name, email: user.email, role: 'member', joinedAt: membership?.createdAt ?? new Date() });
	}

	async updateTeamMemberRole(actingUserId: string, teamId: string, targetUserId: string, role: 'owner' | 'member'): Promise<TeamMemberView> {
		await this.requireTeamRole(actingUserId, teamId, 'owner');

		const [target] = await db
			.select({
				userId: users.id,
				name: users.name,
				email: users.email,
				role: teamMembers.role,
				joinedAt: teamMembers.createdAt
			})
			.from(teamMembers)
			.innerJoin(users, eq(teamMembers.userId, users.id))
			.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
			.limit(1);
		if (!target) throw new MemberNotFoundError();

		if (target.role === role) return toMemberView(target);
		if (target.role === 'owner' && role === 'member' && (await this.ownerCount(teamId)) <= 1) throw new LastOwnerError();

		await db
			.update(teamMembers)
			.set({ role })
			.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));

		return toMemberView({ ...target, role });
	}

	async removeTeamMember(actingUserId: string, teamId: string, targetUserId: string): Promise<void> {
		const actingRole = await this.requireTeamRole(actingUserId, teamId, 'member');
		const isSelf = targetUserId === actingUserId;

		if (!isSelf && actingRole !== 'owner') throw new TeamForbiddenError();

		const [target] = await db
			.select({ role: teamMembers.role })
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
			.limit(1);
		if (!target) throw new MemberNotFoundError();
		if (target.role === 'owner' && (await this.ownerCount(teamId)) <= 1) throw new LastOwnerError();

		await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));
	}

	private async loadTeamView(userId: string, teamId: string): Promise<TeamView | null> {
		const [row] = await db
			.select({
				id: teams.id,
				name: teams.name,
				role: teamMembers.role,
				defaultForUserId: teams.defaultForUserId,
				joinedAt: teamMembers.createdAt
			})
			.from(teamMembers)
			.innerJoin(teams, eq(teamMembers.teamId, teams.id))
			.where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)))
			.limit(1);

		return row ? toTeamView(row, userId) : null;
	}

	async requireTeamRole(actingUserId: string, teamId: string, min: 'member' | 'owner'): Promise<'owner' | 'member'> {
		const [row] = await db
			.select({ role: teamMembers.role })
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actingUserId)))
			.limit(1);

		if (!row) throw new TeamNotFoundError();
		if (min === 'owner' && row.role !== 'owner') throw new TeamForbiddenError();
		return row.role;
	}

	private async ownerCount(teamId: string): Promise<number> {
		const [row] = await db
			.select({ value: count() })
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'owner')));

		return row?.value ?? 0;
	}
}
