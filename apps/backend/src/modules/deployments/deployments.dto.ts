import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { DeploymentLogEntry } from '@kubwave/db';
import { serviceTypes } from '../services/services.dto.js';
import type { ServiceConfigView } from '../services/services.types.js';
import type { DeploymentView } from './deployments.types.js';

export const deploymentIdParamSchema = z.object({ deploymentId: z.string().uuid() });
export const deploymentStatusSchema = z.enum(['pending', 'deploying', 'canceling', 'succeeded', 'failed', 'superseded', 'canceled']);
export const deploymentStatuses = deploymentStatusSchema.options;
export const deploymentTriggers = ['manual', 'auto', 'preview'] as const;

export type DeploymentIdParam = z.infer<typeof deploymentIdParamSchema>;

export class DeploymentViewDto implements DeploymentView {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String, format: 'uuid' })
	serviceId!: string;

	@ApiProperty({ enum: serviceTypes })
	type!: DeploymentView['type'];

	@ApiProperty({ enum: deploymentStatuses })
	status!: DeploymentView['status'];

	@ApiProperty({ type: String, nullable: true })
	phase!: string | null;

	@ApiProperty({ type: String, nullable: true })
	lastError!: string | null;

	@ApiProperty({ type: Number })
	attempts!: number;

	@ApiProperty({ type: Object, additionalProperties: true })
	config!: ServiceConfigView;

	@ApiProperty({ enum: deploymentTriggers })
	trigger!: DeploymentView['trigger'];

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	triggeredByUserId!: string | null;

	@ApiProperty({ type: String })
	createdAt!: string;

	@ApiProperty({ type: String, nullable: true })
	startedAt!: string | null;

	@ApiProperty({ type: String, nullable: true })
	finishedAt!: string | null;
}

export class DeploymentLogEntryDto implements DeploymentLogEntry {
	@ApiProperty({ type: String })
	ts!: string;

	@ApiProperty({ enum: ['info', 'warn', 'error'] })
	level!: DeploymentLogEntry['level'];

	@ApiProperty({ type: String })
	step!: string;

	@ApiProperty({ type: String })
	message!: string;
}

export class DeploymentEventLogsDto {
	@ApiProperty({ type: [DeploymentLogEntryDto] })
	logs!: DeploymentLogEntryDto[];
}

export class DeploymentBuildLogContainerDto {
	@ApiProperty({ type: String })
	containerName!: string;

	@ApiProperty({ type: String })
	content!: string;

	@ApiProperty({ type: String, nullable: true })
	updatedAt!: string | null;
}

export class DeploymentBuildLogsDto {
	@ApiProperty({ type: [DeploymentBuildLogContainerDto] })
	containers!: DeploymentBuildLogContainerDto[];
}
