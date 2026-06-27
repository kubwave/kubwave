import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updateDeploymentConcurrencySettingsSchema = z.object({
	maxConcurrentDeployments: z.number().int().min(1).max(20)
});

export type UpdateDeploymentConcurrencySettingsInput = z.infer<typeof updateDeploymentConcurrencySettingsSchema>;

export class DeploymentConcurrencySettingsDto {
	@ApiProperty({ type: Number, minimum: 1, maximum: 20 })
	maxConcurrentDeployments!: number;
}

export class UpdateDeploymentConcurrencySettingsDto implements UpdateDeploymentConcurrencySettingsInput {
	@ApiProperty({ type: Number, minimum: 1, maximum: 20 })
	maxConcurrentDeployments!: number;
}
