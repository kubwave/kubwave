import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const gitTeamParamSchema = z.object({ teamId: z.string().uuid() });
export type GitTeamParam = z.infer<typeof gitTeamParamSchema>;

export const gitInstallationParamSchema = z.object({ teamId: z.string().uuid(), installationId: z.string().uuid() });
export type GitInstallationParam = z.infer<typeof gitInstallationParamSchema>;

export const bindInstallationSchema = z.object({ githubInstallationId: z.string().trim().min(1).max(40) });
export type BindInstallationInput = z.infer<typeof bindInstallationSchema>;

export class BindInstallationDto {
	@ApiProperty({ type: String, description: 'GitHub numeric installation id returned to the setup redirect.' })
	githubInstallationId!: string;
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
