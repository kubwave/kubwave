import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { EnvironmentDto } from '../environments/environments.dto.js';

export const projectIdParamSchema = z.object({ projectId: z.string().uuid() });
export const teamProjectParamSchema = z.object({ teamId: z.string().uuid() });

export const createProjectSchema = z.object({
	name: z.string().trim().min(1).max(100),
	description: z.string().trim().max(1000).optional()
});

export const updateProjectSchema = z.object({
	name: z.string().trim().min(1).max(100).optional(),
	description: z.string().trim().max(1000).optional()
});

export const updateProjectPrPreviewsSchema = z.object({
	baseEnvironmentId: z.string().uuid().nullable()
});

export type ProjectIdParam = z.infer<typeof projectIdParamSchema>;
export type TeamProjectParam = z.infer<typeof teamProjectParamSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type UpdateProjectPrPreviewsInput = z.infer<typeof updateProjectPrPreviewsSchema>;

export class ProjectListItemDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String, format: 'uuid' })
	teamId!: string;

	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: String })
	description!: string;

	@ApiProperty({ type: Number })
	environmentCount!: number;

	@ApiProperty({ type: Number })
	serviceCount!: number;

	@ApiProperty({ type: String })
	createdAt!: string;

	@ApiProperty({ type: String })
	updatedAt!: string;
}

export class ProjectDetailDto extends ProjectListItemDto {
	@ApiProperty({ type: [EnvironmentDto] })
	environments!: EnvironmentDto[];
}

export class CreateProjectDto implements CreateProjectInput {
	@ApiProperty({ type: String, minLength: 1, maxLength: 100 })
	name!: string;

	@ApiProperty({ type: String, maxLength: 1000, required: false })
	description?: string;
}

export class UpdateProjectDto implements UpdateProjectInput {
	@ApiProperty({ type: String, minLength: 1, maxLength: 100, required: false })
	name?: string;

	@ApiProperty({ type: String, maxLength: 1000, required: false })
	description?: string;
}

export class UpdateProjectPrPreviewsDto implements UpdateProjectPrPreviewsInput {
	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	baseEnvironmentId!: string | null;
}

export class ProjectOkDto {
	@ApiProperty({ type: Boolean })
	ok!: true;
}
