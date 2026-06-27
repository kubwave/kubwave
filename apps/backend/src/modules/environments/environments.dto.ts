import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const environmentIdParamSchema = z.object({ environmentId: z.string().uuid() });
export const projectEnvironmentParamSchema = z.object({ projectId: z.string().uuid() });

export const createEnvironmentSchema = z.object({
	name: z.string().trim().min(1).max(100)
});

export const updateEnvironmentSchema = z.object({
	name: z.string().trim().min(1).max(100).optional(),
	prPreviewsEnabled: z.boolean().optional()
});

export type EnvironmentIdParam = z.infer<typeof environmentIdParamSchema>;
export type ProjectEnvironmentParam = z.infer<typeof projectEnvironmentParamSchema>;
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;

export class EnvironmentDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String, format: 'uuid' })
	projectId!: string;

	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ enum: ['persistent', 'preview'] })
	kind!: 'persistent' | 'preview';

	@ApiProperty({ type: Boolean })
	prPreviewsEnabled!: boolean;

	@ApiProperty({ type: Number, nullable: true })
	prNumber!: number | null;

	@ApiProperty({ type: String, nullable: true })
	prRepoUrl!: string | null;

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	baseEnvironmentId!: string | null;

	@ApiProperty({ type: Number })
	serviceCount!: number;

	@ApiProperty({ type: String })
	createdAt!: string;

	@ApiProperty({ type: String })
	updatedAt!: string;
}

export class CreateEnvironmentDto implements CreateEnvironmentInput {
	@ApiProperty({ type: String, minLength: 1, maxLength: 100 })
	name!: string;
}

export class UpdateEnvironmentDto implements UpdateEnvironmentInput {
	@ApiProperty({ type: String, minLength: 1, maxLength: 100, required: false })
	name?: string;

	@ApiProperty({ type: Boolean, required: false })
	prPreviewsEnabled?: boolean;
}

export class EnvironmentOkDto {
	@ApiProperty({ type: Boolean })
	ok!: true;
}
