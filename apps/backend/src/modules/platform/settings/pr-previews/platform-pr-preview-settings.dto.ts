import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updatePrPreviewSettingsSchema = z.object({
	maxPreviewsPerProject: z.number().int().min(0).max(100)
});

export type UpdatePrPreviewSettingsInput = z.infer<typeof updatePrPreviewSettingsSchema>;

export class PrPreviewSettingsDto {
	@ApiProperty({ type: Number })
	maxPreviewsPerProject!: number;
}

export class UpdatePrPreviewSettingsDto implements UpdatePrPreviewSettingsInput {
	@ApiProperty({ type: Number, minimum: 0, maximum: 100 })
	maxPreviewsPerProject!: number;
}
