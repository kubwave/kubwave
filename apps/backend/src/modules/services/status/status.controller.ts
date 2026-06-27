import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { environmentIdParamSchema, type EnvironmentIdParam } from '../../environments/environments.dto.js';
import { serviceIdParamSchema, type ServiceIdParam } from '../services.dto.js';
import { ServiceRuntimeDto, ServiceRuntimeEntryDto } from './status.dto.js';
import { ServiceStatusService } from './status.service.js';

@ApiTags('services')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class ServiceStatusController {
	constructor(private readonly status: ServiceStatusService) {}

	@Get('services/:serviceId/status')
	@ApiOperation({ operationId: 'serviceStatusGet', summary: 'Get live service runtime status' })
	@ApiOkResponse({ type: ServiceRuntimeDto })
	getServiceStatus(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam
	): Promise<ServiceRuntimeDto> {
		return this.status.getServiceRuntime(userId, params.serviceId);
	}

	@Get('environments/:environmentId/services/status')
	@ApiOperation({ operationId: 'environmentServiceStatusList', summary: 'List live runtime status for services in an environment' })
	@ApiOkResponse({ type: [ServiceRuntimeEntryDto] })
	listEnvironmentServiceStatus(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentIdParamSchema)) params: EnvironmentIdParam
	): Promise<ServiceRuntimeEntryDto[]> {
		return this.status.listEnvironmentServiceRuntime(userId, params.environmentId);
	}
}
