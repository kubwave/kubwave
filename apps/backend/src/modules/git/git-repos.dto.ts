import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const gitTeamParamSchema = z.object({ teamId: z.string().uuid() });
export type GitTeamParam = z.infer<typeof gitTeamParamSchema>;

export const gitInstallationParamSchema = z.object({ teamId: z.string().uuid(), installationId: z.string().uuid() });
export type GitInstallationParam = z.infer<typeof gitInstallationParamSchema>;

export const claimInstallationSchema = z.object({ grant: z.string().trim().min(1).max(2048) });
export type ClaimInstallationInput = z.infer<typeof claimInstallationSchema>;

export class ClaimInstallationDto {
	@ApiProperty({ type: String, description: 'Signed grant from the install callback redirect (git_grant query param).' })
	grant!: string;
}

export class GitInstallationDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String })
	githubInstallationId!: string;

	@ApiProperty({ type: String })
	accountLogin!: string;

	@ApiProperty({ type: String })
	accountType!: string;

	@ApiProperty({ type: Boolean })
	suspended!: boolean;

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt!: string;
}

export class GitRepositoryDto {
	@ApiProperty({ type: String })
	repoFullName!: string;

	@ApiProperty({ type: String })
	defaultBranch!: string;

	@ApiProperty({ type: Boolean })
	isPrivate!: boolean;
}

export class TeamGitConnectionDto {
	@ApiProperty({ type: Boolean })
	connected!: boolean;

	@ApiProperty({ type: String, nullable: true, description: 'Where a team owner installs the App on their repositories.' })
	installUrl!: string | null;
}
