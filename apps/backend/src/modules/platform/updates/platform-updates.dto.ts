import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updateRunIdParamSchema = z.object({ id: z.string().uuid() });
export const triggerUpdateSchema = z.object({ targetVersion: z.string().min(1) });

export type UpdateRunIdParam = z.infer<typeof updateRunIdParamSchema>;
export type TriggerUpdateInput = z.infer<typeof triggerUpdateSchema>;

export class TriggerUpdateDto implements TriggerUpdateInput {
	@ApiProperty({ type: String, minLength: 1 })
	targetVersion!: string;
}

export class UpdateRunDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String })
	fromVersion!: string;

	@ApiProperty({ type: String })
	toVersion!: string;

	@ApiProperty({ type: String })
	status!: string;

	@ApiProperty({ type: String, nullable: true })
	startedAt!: string | null;

	@ApiProperty({ type: String, nullable: true })
	finishedAt!: string | null;

	@ApiProperty({ type: String, nullable: true })
	phase!: string | null;

	@ApiProperty({ type: String, nullable: true })
	lastError!: string | null;

	@ApiProperty({ type: String, nullable: true })
	jobName!: string | null;

	@ApiProperty({ type: Object, additionalProperties: true, nullable: true })
	oldImageTags!: Record<string, string> | null;

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	triggeredByUserId!: string | null;

	@ApiProperty({ type: String })
	createdAt!: string;
}

export class UpdateLogsDto {
	@ApiProperty({ type: String })
	logs!: string;
}
