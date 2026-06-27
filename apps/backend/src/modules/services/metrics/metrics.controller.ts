import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { serviceIdParamSchema, type ServiceIdParam } from '../services.dto.js';
import { ServiceMetricsDto, serviceMetricsQuerySchema, type ServiceMetricsQuery } from './metrics.dto.js';
import { ServiceMetricsService } from './metrics.service.js';

@ApiTags('services')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class ServiceMetricsController {
	constructor(private readonly metrics: ServiceMetricsService) {}

	@Get('services/:serviceId/metrics')
	@ApiOperation({ operationId: 'serviceMetricsGet', summary: 'Get service CPU, memory, network, and PVC metrics' })
	@ApiQuery({ name: 'range', enum: ['1h', '24h', '7d'], required: false })
	@ApiOkResponse({ type: ServiceMetricsDto })
	getServiceMetrics(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(serviceIdParamSchema)) params: ServiceIdParam,
		@Query(new ZodValidationPipe(serviceMetricsQuerySchema)) query: ServiceMetricsQuery
	): Promise<ServiceMetricsDto> {
		return this.metrics.getServiceMetrics(userId, params.serviceId, query.range);
	}
}
