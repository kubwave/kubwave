import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import { HaSettingsDto, UpdateHaSettingsDto, updateHaSettingsSchema, type UpdateHaSettingsInput } from './platform-ha-settings.dto.js';
import { PlatformHaSettingsService } from './platform-ha-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/ha')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformHaSettingsController {
	constructor(private readonly haSettings: PlatformHaSettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsHaGet', summary: 'Get HA settings' })
	@ApiOkResponse({ type: HaSettingsDto })
	getSettings(): Promise<HaSettingsDto> {
		return this.haSettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsHaUpdate', summary: 'Update HA settings' })
	@ApiBody({ type: UpdateHaSettingsDto })
	@ApiOkResponse({ type: HaSettingsDto })
	updateSettings(@Body(new ZodValidationPipe(updateHaSettingsSchema)) body: UpdateHaSettingsInput): Promise<HaSettingsDto> {
		return this.haSettings.updateSettings(body);
	}
}
