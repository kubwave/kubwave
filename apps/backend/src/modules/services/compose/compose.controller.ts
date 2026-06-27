import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import {
	CreateComposeServicesDto,
	ServiceViewDto,
	createComposeServicesSchema,
	environmentServiceParamSchema,
	type CreateComposeServicesInput,
	type EnvironmentServiceParam
} from '../services.dto.js';
import { ServicesService } from '../services.service.js';

@ApiTags('environments')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class ServiceComposeController {
	constructor(private readonly services: ServicesService) {}

	@Post('environments/:environmentId/services/compose')
	@ApiOperation({ operationId: 'environmentServicesComposeCreate', summary: 'Import services from Docker Compose' })
	@ApiBody({ type: CreateComposeServicesDto })
	@ApiCreatedResponse({ type: [ServiceViewDto] })
	createServicesFromCompose(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentServiceParamSchema)) params: EnvironmentServiceParam,
		@Body(new ZodValidationPipe(createComposeServicesSchema)) body: CreateComposeServicesInput
	): Promise<ServiceViewDto[]> {
		return this.services.createServicesFromCompose(userId, params.environmentId, body);
	}
}
