import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import {
	DeploymentConcurrencySettingsDto,
	UpdateDeploymentConcurrencySettingsDto,
	updateDeploymentConcurrencySettingsSchema,
	type UpdateDeploymentConcurrencySettingsInput
} from './platform-deployment-concurrency-settings.dto.js';
import { PlatformDeploymentConcurrencySettingsService } from './platform-deployment-concurrency-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/deployment-concurrency')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformDeploymentConcurrencySettingsController {
	constructor(private readonly concurrencySettings: PlatformDeploymentConcurrencySettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsDeploymentConcurrencyGet', summary: 'Get deployment concurrency settings' })
	@ApiOkResponse({ type: DeploymentConcurrencySettingsDto })
	getSettings(): Promise<DeploymentConcurrencySettingsDto> {
		return this.concurrencySettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsDeploymentConcurrencyUpdate', summary: 'Update deployment concurrency settings' })
	@ApiBody({ type: UpdateDeploymentConcurrencySettingsDto })
	@ApiOkResponse({ type: DeploymentConcurrencySettingsDto })
	updateSettings(
		@Body(new ZodValidationPipe(updateDeploymentConcurrencySettingsSchema)) body: UpdateDeploymentConcurrencySettingsInput
	): Promise<DeploymentConcurrencySettingsDto> {
		return this.concurrencySettings.updateSettings(body);
	}
}
