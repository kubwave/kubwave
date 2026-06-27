import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const sshKeyNameSchema = z.string().trim().min(1).max(100);

export const createSshKeySchema = z.discriminatedUnion('mode', [
	z.object({
		mode: z.literal('generate'),
		name: sshKeyNameSchema
	}),
	z.object({
		mode: z.literal('upload'),
		name: sshKeyNameSchema,
		privateKey: z.string().trim().min(1).max(20_000)
	})
]);

export const sshKeyTeamParamSchema = z.object({ teamId: z.string().uuid() });
export const sshKeyIdParamSchema = z.object({ teamId: z.string().uuid(), keyId: z.string().uuid() });

export type CreateSshKeyInput = z.infer<typeof createSshKeySchema>;
export type SshKeyTeamParam = z.infer<typeof sshKeyTeamParamSchema>;
export type SshKeyIdParam = z.infer<typeof sshKeyIdParamSchema>;

export class CreateSshKeyDto {
	@ApiProperty({ enum: ['generate', 'upload'] })
	mode!: CreateSshKeyInput['mode'];

	@ApiProperty({ type: String, minLength: 1, maxLength: 100 })
	name!: string;

	@ApiProperty({ type: String, required: false, maxLength: 20_000 })
	privateKey?: string;
}

export class SshKeyDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ enum: ['team', 'admin'] })
	scope!: 'team' | 'admin';

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	teamId!: string | null;

	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ enum: ['ed25519', 'rsa', 'ecdsa'] })
	keyType!: 'ed25519' | 'rsa' | 'ecdsa';

	@ApiProperty({ enum: ['generated', 'uploaded'] })
	source!: 'generated' | 'uploaded';

	@ApiProperty({ type: String })
	publicKey!: string;

	@ApiProperty({ type: String })
	fingerprint!: string;

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	createdByUserId!: string | null;

	@ApiProperty({ type: String })
	createdAt!: string;

	@ApiProperty({ type: String })
	updatedAt!: string;
}

export class SshKeyOkDto {
	@ApiProperty({ type: Boolean })
	ok!: true;
}
