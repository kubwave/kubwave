import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { serviceIdParamSchema, type ServiceIdParam } from '../services/services.dto.js';
import {
	DeploymentBuildLogsDto,
	DeploymentEventLogsDto,
	DeploymentViewDto,
	deploymentIdParamSchema,
	type DeploymentIdParam
} from './deployments.dto.js';
import { DeploymentsService } from './deployments.service.js';

@ApiTags('deployments')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class DeploymentsController {
	constructor(private readonly deployments: DeploymentsService) {}

	@Get('services/:serviceId/deployments')
	@ApiOperation({ operationId: 'serviceDeploymentsList', summary: 'List deployment history for a service' })
	@ApiOkResponse({ type: [DeploymentViewDto] })
	listServiceDeployments(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam
	): Promise<DeploymentViewDto[]> {
		return this.deployments.listDeployments(userId, params.serviceId);
	}

	@Post('services/:serviceId/deployments')
	@ApiOperation({ operationId: 'serviceDeploymentsEnqueue', summary: 'Queue a deployment for a service' })
	@ApiCreatedResponse({ type: DeploymentViewDto })
	enqueueServiceDeployment(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam
	): Promise<DeploymentViewDto> {
		return this.deployments.enqueueDeployment(userId, params.serviceId);
	}

	@Get('deployments/:deploymentId')
	@ApiOperation({ operationId: 'deploymentsGet', summary: 'Get deployment details' })
	@ApiOkResponse({ type: DeploymentViewDto })
	getDeployment(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(deploymentIdParamSchema)) params: DeploymentIdParam
	): Promise<DeploymentViewDto> {
		return this.deployments.getDeployment(userId, params.deploymentId);
	}

	@Get('deployments/:deploymentId/logs')
	@ApiOperation({ operationId: 'deploymentLogsList', summary: 'List deployment event logs' })
	@ApiOkResponse({ type: DeploymentEventLogsDto })
	listDeploymentLogs(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(deploymentIdParamSchema)) params: DeploymentIdParam
	): Promise<DeploymentEventLogsDto> {
		return this.deployments.listDeploymentLogs(userId, params.deploymentId);
	}

	@Get('deployments/:deploymentId/build-logs')
	@ApiOperation({ operationId: 'deploymentBuildLogsGet', summary: 'Get deployment build logs' })
	@ApiOkResponse({ type: DeploymentBuildLogsDto })
	getDeploymentBuildLogs(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(deploymentIdParamSchema)) params: DeploymentIdParam
	): Promise<DeploymentBuildLogsDto> {
		return this.deployments.getDeploymentBuildLogs(userId, params.deploymentId);
	}

	@Post('deployments/:deploymentId/cancel')
	@HttpCode(200)
	@ApiOperation({ operationId: 'deploymentsCancel', summary: 'Cancel a deployment' })
	@ApiOkResponse({ type: DeploymentViewDto })
	cancelDeployment(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(deploymentIdParamSchema)) params: DeploymentIdParam
	): Promise<DeploymentViewDto> {
		return this.deployments.cancelDeployment(userId, params.deploymentId);
	}
}
