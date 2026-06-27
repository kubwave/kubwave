import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { LoginResponseDto } from '../auth/auth.dto.js';

export const setupInitializeSchema = z.object({
	name: z.string().trim().min(1).max(80),
	email: z.string().email(),
	password: z.string().min(12).max(200)
});

export type SetupInitializeInput = z.infer<typeof setupInitializeSchema>;

export class SetupInitializeRequestDto implements SetupInitializeInput {
	@ApiProperty({ type: String, minLength: 1, maxLength: 80 })
	name!: string;

	@ApiProperty({ type: String, format: 'email' })
	email!: string;

	@ApiProperty({ type: String, minLength: 12, maxLength: 200 })
	password!: string;
}

export class SetupStatusResponseDto {
	@ApiProperty({ type: Boolean })
	initialized!: boolean;

	@ApiProperty({ type: Boolean })
	registryConfigured!: boolean;
}

export class SetupInitializeResponseDto extends LoginResponseDto {}
