import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const teamIdParamSchema = z.object({ teamId: z.string().uuid() });
export const teamMemberParamSchema = z.object({ teamId: z.string().uuid(), userId: z.string().uuid() });

export const createTeamSchema = z.object({
	name: z.string().trim().min(1).max(100)
});

export const renameTeamSchema = createTeamSchema;

export const setActiveTeamSchema = z.object({
	teamId: z.string().uuid()
});

export const addMemberSchema = z.object({
	email: z.string().trim().toLowerCase().email()
});

export const updateMemberRoleSchema = z.object({
	role: z.enum(['owner', 'member'])
});

export type TeamIdParam = z.infer<typeof teamIdParamSchema>;
export type TeamMemberParam = z.infer<typeof teamMemberParamSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type RenameTeamInput = z.infer<typeof renameTeamSchema>;
export type SetActiveTeamInput = z.infer<typeof setActiveTeamSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export class TeamDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ enum: ['owner', 'member'] })
	role!: 'owner' | 'member';

	@ApiProperty({ type: Boolean })
	isDefault!: boolean;

	@ApiProperty({ type: String })
	joinedAt!: string;
}

export class TeamStateDto {
	@ApiProperty({ type: [TeamDto] })
	teams!: TeamDto[];

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	activeTeamId!: string | null;
}

export class CreateTeamDto implements CreateTeamInput {
	@ApiProperty({ type: String, minLength: 1, maxLength: 100 })
	name!: string;
}

export class RenameTeamDto implements RenameTeamInput {
	@ApiProperty({ type: String, minLength: 1, maxLength: 100 })
	name!: string;
}

export class SetActiveTeamDto implements SetActiveTeamInput {
	@ApiProperty({ type: String, format: 'uuid' })
	teamId!: string;
}

export class ActiveTeamResponseDto {
	@ApiProperty({ type: String, format: 'uuid' })
	activeTeamId!: string;

	@ApiProperty({ type: TeamDto })
	team!: TeamDto;
}

export class TeamMemberDto {
	@ApiProperty({ type: String, format: 'uuid' })
	userId!: string;

	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: String, format: 'email' })
	email!: string;

	@ApiProperty({ enum: ['owner', 'member'] })
	role!: 'owner' | 'member';

	@ApiProperty({ type: String })
	joinedAt!: string;
}

export class AddMemberDto implements AddMemberInput {
	@ApiProperty({ type: String, format: 'email' })
	email!: string;
}

export class UpdateMemberRoleDto implements UpdateMemberRoleInput {
	@ApiProperty({ enum: ['owner', 'member'] })
	role!: 'owner' | 'member';
}

export class OkDto {
	@ApiProperty({ type: Boolean })
	ok!: true;
}
