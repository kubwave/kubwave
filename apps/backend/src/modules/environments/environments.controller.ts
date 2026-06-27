import { Body, Controller, Delete, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import {
	CreateEnvironmentDto,
	EnvironmentDto,
	EnvironmentOkDto,
	UpdateEnvironmentDto,
	createEnvironmentSchema,
	environmentIdParamSchema,
	projectEnvironmentParamSchema,
	updateEnvironmentSchema,
	type CreateEnvironmentInput,
	type EnvironmentIdParam,
	type ProjectEnvironmentParam,
	type UpdateEnvironmentInput
} from './environments.dto.js';
import { EnvironmentsService } from './environments.service.js';

@ApiTags('environments')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class EnvironmentsController {
	constructor(private readonly environments: EnvironmentsService) {}

	@Post('projects/:projectId/environments')
	@HttpCode(201)
	@ApiOperation({ operationId: 'projectEnvironmentsCreate', summary: 'Create an environment in a project' })
	@ApiBody({ type: CreateEnvironmentDto })
	@ApiCreatedResponse({ type: EnvironmentDto })
	createProjectEnvironment(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(projectEnvironmentParamSchema)) params: ProjectEnvironmentParam,
		@Body(new ZodValidationPipe(createEnvironmentSchema)) body: CreateEnvironmentInput
	): Promise<EnvironmentDto> {
		return this.environments.createEnvironment(userId, params.projectId, body);
	}

	@Patch('environments/:environmentId')
	@ApiOperation({ operationId: 'environmentsUpdate', summary: 'Update an environment' })
	@ApiBody({ type: UpdateEnvironmentDto })
	@ApiOkResponse({ type: EnvironmentDto })
	updateEnvironment(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentIdParamSchema)) params: EnvironmentIdParam,
		@Body(new ZodValidationPipe(updateEnvironmentSchema)) body: UpdateEnvironmentInput
	): Promise<EnvironmentDto> {
		return this.environments.updateEnvironment(userId, params.environmentId, body);
	}

	@Delete('environments/:environmentId')
	@ApiOperation({ operationId: 'environmentsDelete', summary: 'Delete an environment' })
	@ApiOkResponse({ type: EnvironmentOkDto })
	async deleteEnvironment(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentIdParamSchema)) params: EnvironmentIdParam
	): Promise<EnvironmentOkDto> {
		await this.environments.deleteEnvironment(userId, params.environmentId);
		return { ok: true };
	}
}
