import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updateHaSettingsSchema = z.object({
	enabled: z.boolean()
});

export type UpdateHaSettingsInput = z.infer<typeof updateHaSettingsSchema>;

export class HaSettingsDto {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;
}

export class UpdateHaSettingsDto implements UpdateHaSettingsInput {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;
}
