import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const giQuantitySchema = z
	.string()
	.regex(/^\d+Gi$/, 'Must be a whole-Gi quantity like "100Gi"')
	.refine(value => Number(value.slice(0, -2)) >= 10, { message: 'Must be at least 10Gi' });

export const volumeAutoscalingSettingsSchema = z.object({
	enabled: z.boolean(),
	thresholdPercent: z.number().int().min(50).max(95),
	growthPercent: z.number().int().min(10).max(100),
	caps: z.object({ postgres: giQuantitySchema, registry: giQuantitySchema, prometheus: giQuantitySchema })
});

export type VolumeAutoscalingSettingsInput = z.infer<typeof volumeAutoscalingSettingsSchema>;

export class VolumeAutoscalingCapsDto {
	@ApiProperty({ type: String, pattern: '^\\d+Gi$' })
	postgres!: string;

	@ApiProperty({ type: String, pattern: '^\\d+Gi$' })
	registry!: string;

	@ApiProperty({ type: String, pattern: '^\\d+Gi$' })
	prometheus!: string;
}

export class VolumeAutoscalingSettingsDto implements VolumeAutoscalingSettingsInput {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;

	@ApiProperty({ type: Number, minimum: 50, maximum: 95 })
	thresholdPercent!: number;

	@ApiProperty({ type: Number, minimum: 10, maximum: 100 })
	growthPercent!: number;

	@ApiProperty({ type: VolumeAutoscalingCapsDto })
	caps!: VolumeAutoscalingCapsDto;
}
