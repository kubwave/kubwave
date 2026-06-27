import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { db, sshKeys } from '@kubwave/db';
import { TeamsService } from '../teams.service.js';
import { buildTeamSshKeyInsert, toSshKeyView } from './ssh-keys.config.js';
import type { CreateSshKeyInput, SshKeyDto } from './ssh-keys.dto.js';
import { SshKeyNameTakenError, SshKeyNotFoundError } from './ssh-keys.errors.js';

@Injectable()
export class TeamSshKeysService {
	constructor(private readonly teams: TeamsService) {}

	async listTeamSshKeys(actingUserId: string, teamId: string): Promise<SshKeyDto[]> {
		await this.teams.requireTeamRole(actingUserId, teamId, 'member');

		const rows = await db
			.select()
			.from(sshKeys)
			.where(and(eq(sshKeys.scope, 'team'), eq(sshKeys.teamId, teamId)))
			.orderBy(desc(sshKeys.createdAt));

		return rows.map(toSshKeyView);
	}

	async createTeamSshKey(actingUserId: string, teamId: string, input: CreateSshKeyInput): Promise<SshKeyDto> {
		await this.teams.requireTeamRole(actingUserId, teamId, 'owner');

		const values = buildTeamSshKeyInsert(input, teamId, actingUserId);
		const [row] = await db
			.insert(sshKeys)
			.values(values)
			.onConflictDoNothing({ target: [sshKeys.teamId, sshKeys.name] })
			.returning();

		if (!row) throw new SshKeyNameTakenError();
		return toSshKeyView(row);
	}

	async deleteTeamSshKey(actingUserId: string, teamId: string, keyId: string): Promise<void> {
		await this.teams.requireTeamRole(actingUserId, teamId, 'owner');

		const [deleted] = await db
			.delete(sshKeys)
			.where(and(eq(sshKeys.id, keyId), eq(sshKeys.scope, 'team'), eq(sshKeys.teamId, teamId)))
			.returning({ id: sshKeys.id });

		if (!deleted) throw new SshKeyNotFoundError();
	}
}
