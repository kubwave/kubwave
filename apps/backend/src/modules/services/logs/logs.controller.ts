import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { serviceIdParamSchema, type ServiceIdParam } from '../services.dto.js';
import { ServiceLogsDto, serviceLogsQuerySchema, type ServiceLogsQuery } from './logs.dto.js';
import { ServiceLogsService } from './logs.service.js';

@ApiTags('services')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class ServiceLogsController {
	constructor(private readonly logs: ServiceLogsService) {}

	@Get('services/:serviceId/logs')
	@ApiOperation({ operationId: 'serviceLogsGet', summary: 'Get recent container logs for a service' })
	@ApiQuery({ name: 'pod', type: String, required: false })
	@ApiQuery({ name: 'tailLines', type: Number, required: false })
	@ApiOkResponse({ type: ServiceLogsDto })
	getServiceLogs(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam,
		@Query(new ZodValidationPipe(serviceLogsQuerySchema)) query: ServiceLogsQuery
	): Promise<ServiceLogsDto> {
		return this.logs.getServiceLogs(userId, params.serviceId, query);
	}
}
