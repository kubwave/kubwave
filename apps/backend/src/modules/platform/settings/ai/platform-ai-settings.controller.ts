import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import { AiSettingsDto, UpdateAiSettingsDto, updateAiSettingsSchema, type UpdateAiSettingsInput } from './platform-ai-settings.dto.js';
import { PlatformAiSettingsService } from './platform-ai-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/ai')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformAiSettingsController {
	constructor(private readonly aiSettings: PlatformAiSettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsAiGet', summary: 'Get AI assistant settings' })
	@ApiOkResponse({ type: AiSettingsDto })
	getSettings(): Promise<AiSettingsDto> {
		return this.aiSettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsAiUpdate', summary: 'Update AI assistant settings' })
	@ApiBody({ type: UpdateAiSettingsDto })
	@ApiOkResponse({ type: AiSettingsDto })
	updateSettings(@Body(new ZodValidationPipe(updateAiSettingsSchema)) body: UpdateAiSettingsInput): Promise<AiSettingsDto> {
		return this.aiSettings.updateSettings(body);
	}
}
