import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { environmentIdParamSchema } from '../environments.dto.js';

export const flowNodePositionSchema = z.object({
	x: z.number().min(-100_000).max(100_000),
	y: z.number().min(-100_000).max(100_000)
});

export const updateFlowLayoutNodeSchema = z.object({
	position: flowNodePositionSchema,
	baseRevision: z.number().int().positive().nullable(),
	clientMutationId: z.string().uuid().optional()
});

export const environmentFlowNodeParamSchema = environmentIdParamSchema.extend({
	serviceId: z.string().uuid()
});

export type FlowNodePosition = z.infer<typeof flowNodePositionSchema>;
export type UpdateFlowLayoutNodeInput = z.infer<typeof updateFlowLayoutNodeSchema>;
export type EnvironmentFlowNodeParam = z.infer<typeof environmentFlowNodeParamSchema>;

export class FlowNodePositionDto implements FlowNodePosition {
	@ApiProperty({ type: Number, minimum: -100_000, maximum: 100_000 })
	x!: number;

	@ApiProperty({ type: Number, minimum: -100_000, maximum: 100_000 })
	y!: number;
}

export class UpdateFlowLayoutNodeDto implements UpdateFlowLayoutNodeInput {
	@ApiProperty({ type: FlowNodePositionDto })
	position!: FlowNodePositionDto;

	@ApiProperty({ type: Number, nullable: true })
	baseRevision!: number | null;

	@ApiPropertyOptional({ type: String, format: 'uuid' })
	clientMutationId?: string;
}

export class FlowLayoutNodeDto {
	@ApiProperty({ type: String, format: 'uuid' })
	serviceId!: string;

	@ApiProperty({ type: FlowNodePositionDto })
	position!: FlowNodePositionDto;

	@ApiProperty({ type: Number })
	revision!: number;

	@ApiProperty({ type: String })
	updatedAt!: string;
}

export class FlowLayoutDto {
	@ApiProperty({ type: [FlowLayoutNodeDto] })
	nodes!: FlowLayoutNodeDto[];
}

export interface FlowLayoutNodeUpdatedEvent {
	type: 'node_position_updated';
	environmentId: string;
	serviceId: string;
	position: FlowNodePosition;
	revision: number;
	updatedAt: string;
	clientMutationId?: string;
}
