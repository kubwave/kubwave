import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updateRegistrySettingsSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('platform') }),
	z.object({
		mode: z.literal('external'),
		endpoint: z.string().min(1),
		insecure: z.boolean().default(false),
		username: z.string().min(1),
		password: z.string().min(1).optional()
	})
]);

export type UpdateRegistrySettingsInput = z.infer<typeof updateRegistrySettingsSchema>;

export class RegistrySettingsDto {
	@ApiProperty({ enum: ['unconfigured', 'platform', 'external'] })
	mode!: 'unconfigured' | 'platform' | 'external';

	@ApiProperty({ type: String, nullable: true })
	endpoint!: string | null;

	@ApiProperty({ type: Boolean })
	insecure!: boolean;

	@ApiProperty({ type: String, nullable: true })
	username!: string | null;

	@ApiProperty({ type: Boolean })
	hasPassword!: boolean;

	@ApiProperty({ enum: ['not_configured', 'pending', 'applying', 'applied', 'failed'] })
	applyStatus!: 'not_configured' | 'pending' | 'applying' | 'applied' | 'failed';

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	activeRunId!: string | null;

	@ApiProperty({ type: String, nullable: true })
	lastError!: string | null;
}

export class PlatformRegistryModeDto {
	@ApiProperty({ enum: ['platform'] })
	mode!: 'platform';
}

export class ExternalRegistrySettingsDto {
	@ApiProperty({ enum: ['external'] })
	mode!: 'external';

	@ApiProperty({ type: String, minLength: 1 })
	endpoint!: string;

	@ApiProperty({ type: Boolean, default: false })
	insecure!: boolean;

	@ApiProperty({ type: String, minLength: 1 })
	username!: string;

	@ApiProperty({ type: String, minLength: 1, required: false, writeOnly: true })
	password?: string;
}
