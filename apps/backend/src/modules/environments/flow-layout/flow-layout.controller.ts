import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { environmentIdParamSchema, type EnvironmentIdParam } from '../environments.dto.js';
import {
	FlowLayoutDto,
	FlowLayoutNodeDto,
	UpdateFlowLayoutNodeDto,
	environmentFlowNodeParamSchema,
	updateFlowLayoutNodeSchema,
	type EnvironmentFlowNodeParam,
	type UpdateFlowLayoutNodeInput
} from './flow-layout.dto.js';
import { FlowLayoutService } from './flow-layout.service.js';

@ApiTags('environments')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class FlowLayoutController {
	constructor(private readonly flowLayout: FlowLayoutService) {}

	@Get('environments/:environmentId/flow-layout')
	@ApiOperation({ operationId: 'environmentFlowLayoutGet', summary: 'Get persisted service node positions' })
	@ApiOkResponse({ type: FlowLayoutDto })
	getEnvironmentFlowLayout(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentIdParamSchema)) params: EnvironmentIdParam
	): Promise<FlowLayoutDto> {
		return this.flowLayout.getEnvironmentFlowLayout(userId, params.environmentId);
	}

	@Patch('environments/:environmentId/flow-layout/nodes/:serviceId')
	@ApiOperation({ operationId: 'environmentFlowLayoutNodeUpdate', summary: 'Update a service node position' })
	@ApiBody({ type: UpdateFlowLayoutNodeDto })
	@ApiOkResponse({ type: FlowLayoutNodeDto })
	updateEnvironmentFlowNode(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentFlowNodeParamSchema)) params: EnvironmentFlowNodeParam,
		@Body(new ZodValidationPipe(updateFlowLayoutNodeSchema)) body: UpdateFlowLayoutNodeInput
	): Promise<FlowLayoutNodeDto> {
		return this.flowLayout.updateEnvironmentFlowNode(userId, params.environmentId, params.serviceId, body);
	}
}
