import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import {
	MetricsSettingsDto,
	UpdateMetricsSettingsDto,
	updateMetricsSettingsSchema,
	type UpdateMetricsSettingsInput
} from './platform-metrics-settings.dto.js';
import { PlatformMetricsSettingsService } from './platform-metrics-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/metrics')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformMetricsSettingsController {
	constructor(private readonly metricsSettings: PlatformMetricsSettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsMetricsGet', summary: 'Get metrics provider settings' })
	@ApiOkResponse({ type: MetricsSettingsDto })
	getSettings(): Promise<MetricsSettingsDto> {
		return this.metricsSettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsMetricsUpdate', summary: 'Update metrics provider settings' })
	@ApiBody({ type: UpdateMetricsSettingsDto })
	@ApiOkResponse({ type: MetricsSettingsDto })
	updateSettings(@Body(new ZodValidationPipe(updateMetricsSettingsSchema)) body: UpdateMetricsSettingsInput): Promise<MetricsSettingsDto> {
		return this.metricsSettings.updateSettings(body);
	}
}
