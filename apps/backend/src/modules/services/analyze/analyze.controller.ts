import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { ServiceViewDto, environmentServiceParamSchema, type EnvironmentServiceParam } from '../services.dto.js';
import {
	AiStatusDto,
	AnalyzeRepositoryDto,
	CreateServicesFromPlanDto,
	DeploymentPlanDto,
	analyzeRepositorySchema,
	createServicesFromPlanSchema,
	type AnalyzeRepositoryInput,
	type CreateServicesFromPlanInput
} from './analyze.dto.js';
import { ServiceAnalyzeService } from './analyze.service.js';

@ApiTags('environments')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class ServiceAnalyzeController {
	constructor(private readonly analyze: ServiceAnalyzeService) {}

	@Get('ai/status')
	@ApiOperation({ operationId: 'aiStatusGet', summary: 'Whether the AI assistant is enabled on this instance' })
	@ApiOkResponse({ type: AiStatusDto })
	status(): Promise<AiStatusDto> {
		return this.analyze.status();
	}

	@Post('environments/:environmentId/services/analyze')
	@HttpCode(200)
	@ApiOperation({ operationId: 'environmentServicesAnalyzeRepository', summary: 'Propose services for a repository with the configured AI model' })
	@ApiBody({ type: AnalyzeRepositoryDto })
	@ApiOkResponse({ type: DeploymentPlanDto })
	analyzeRepository(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentServiceParamSchema)) params: EnvironmentServiceParam,
		@Body(new ZodValidationPipe(analyzeRepositorySchema)) body: AnalyzeRepositoryInput
	): Promise<DeploymentPlanDto> {
		return this.analyze.analyze(userId, params.environmentId, body);
	}

	@Post('environments/:environmentId/services/from-plan')
	@ApiOperation({ operationId: 'environmentServicesCreateFromPlan', summary: 'Create the services of a reviewed deployment plan' })
	@ApiBody({ type: CreateServicesFromPlanDto })
	@ApiCreatedResponse({ type: [ServiceViewDto] })
	createFromPlan(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentServiceParamSchema)) params: EnvironmentServiceParam,
		@Body(new ZodValidationPipe(createServicesFromPlanSchema)) body: CreateServicesFromPlanInput
	): Promise<ServiceViewDto[]> {
		return this.analyze.createFromPlan(userId, params.environmentId, body);
	}
}
