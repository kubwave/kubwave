import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import {
	CreateServiceDto,
	ServiceConnectionDto,
	ServiceOkDto,
	ServiceViewDto,
	UpdateServiceDto,
	createServiceSchema,
	environmentServiceParamSchema,
	serviceIdParamSchema,
	updateServiceSchema,
	type CreateServiceInput,
	type EnvironmentServiceParam,
	type ServiceIdParam,
	type UpdateServiceInput
} from './services.dto.js';
import { ServicesService } from './services.service.js';

@ApiTags('services')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class ServicesController {
	constructor(private readonly services: ServicesService) {}

	@Get('environments/:environmentId/services')
	@ApiOperation({ operationId: 'environmentServicesList', summary: 'List services in an environment' })
	@ApiOkResponse({ type: [ServiceViewDto] })
	listEnvironmentServices(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentServiceParamSchema)) params: EnvironmentServiceParam
	): Promise<ServiceViewDto[]> {
		return this.services.listServicesForEnvironment(userId, params.environmentId);
	}

	@Post('environments/:environmentId/services')
	@ApiOperation({ operationId: 'environmentServicesCreate', summary: 'Create a service in an environment' })
	@ApiBody({ type: CreateServiceDto })
	@ApiCreatedResponse({ type: ServiceViewDto })
	createEnvironmentService(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentServiceParamSchema)) params: EnvironmentServiceParam,
		@Body(new ZodValidationPipe(createServiceSchema)) body: CreateServiceInput
	): Promise<ServiceViewDto> {
		return this.services.createService(userId, params.environmentId, body);
	}

	@Get('services/:serviceId')
	@ApiOperation({ operationId: 'servicesGet', summary: 'Get service details' })
	@ApiOkResponse({ type: ServiceViewDto })
	getService(@CurrentUserId() userId: string, @Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam): Promise<ServiceViewDto> {
		return this.services.getService(userId, params.serviceId);
	}

	@Patch('services/:serviceId')
	@ApiOperation({ operationId: 'servicesUpdate', summary: 'Update a service' })
	@ApiBody({ type: UpdateServiceDto })
	@ApiOkResponse({ type: ServiceViewDto })
	updateService(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam,
		@Body(new ZodValidationPipe(updateServiceSchema)) body: UpdateServiceInput
	): Promise<ServiceViewDto> {
		return this.services.updateService(userId, params.serviceId, body);
	}

	@Delete('services/:serviceId')
	@ApiOperation({ operationId: 'servicesDelete', summary: 'Delete a service' })
	@ApiOkResponse({ type: ServiceOkDto })
	async deleteService(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam
	): Promise<ServiceOkDto> {
		await this.services.deleteService(userId, params.serviceId);
		return { ok: true };
	}

	@Get('services/:serviceId/connection')
	@ApiOperation({ operationId: 'servicesConnectionGet', summary: 'Get managed database connection details' })
	@ApiOkResponse({ type: ServiceConnectionDto })
	getServiceConnection(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam
	): Promise<ServiceConnectionDto> {
		return this.services.getServiceConnection(userId, params.serviceId);
	}
}
