import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const connectGiteaSchema = z.object({
	instanceUrl: z.string().trim().min(1).max(512),
	clientId: z.string().trim().min(1).max(255),
	clientSecret: z.string().trim().min(1).max(512)
});
export type ConnectGiteaInput = z.infer<typeof connectGiteaSchema>;

export class ConnectGiteaDto {
	@ApiProperty({ type: String, example: 'https://gitea.example' })
	instanceUrl!: string;

	@ApiProperty({ type: String })
	clientId!: string;

	@ApiProperty({ type: String })
	clientSecret!: string;
}

export class GiteaConnectionDto {
	@ApiProperty({ type: Boolean })
	connected!: boolean;

	@ApiProperty({ type: String, nullable: true })
	instanceUrl!: string | null;

	@ApiProperty({ type: String, nullable: true })
	clientId!: string | null;

	@ApiProperty({ type: String, nullable: true, description: 'Paste this as the OAuth redirect URI on the Gitea application.' })
	callbackUrl!: string | null;

	@ApiProperty({ type: String, nullable: true, description: 'Optional repo webhook URL for instant auto-deploy.' })
	webhookUrl!: string | null;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	connectedAt!: string | null;
}

export class TeamGiteaConnectionDto {
	@ApiProperty({ type: Boolean })
	connected!: boolean;

	@ApiProperty({ type: String, nullable: true, description: 'Where a team owner authorizes kubwave against Gitea.' })
	authorizeUrl!: string | null;
}

export class GiteaAccountDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String })
	giteaUserId!: string;

	@ApiProperty({ type: String })
	accountLogin!: string;

	@ApiProperty({ type: String })
	accountType!: string;

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt!: string;
}
