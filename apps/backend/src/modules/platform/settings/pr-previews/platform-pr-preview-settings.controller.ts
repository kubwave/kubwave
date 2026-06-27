import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import {
	PrPreviewSettingsDto,
	UpdatePrPreviewSettingsDto,
	updatePrPreviewSettingsSchema,
	type UpdatePrPreviewSettingsInput
} from './platform-pr-preview-settings.dto.js';
import { PlatformPrPreviewSettingsService } from './platform-pr-preview-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/pr-previews')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformPrPreviewSettingsController {
	constructor(private readonly prPreviewSettings: PlatformPrPreviewSettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsPrPreviewsGet', summary: 'Get PR preview settings' })
	@ApiOkResponse({ type: PrPreviewSettingsDto })
	getSettings(): Promise<PrPreviewSettingsDto> {
		return this.prPreviewSettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsPrPreviewsUpdate', summary: 'Update PR preview settings' })
	@ApiBody({ type: UpdatePrPreviewSettingsDto })
	@ApiOkResponse({ type: PrPreviewSettingsDto })
	updateSettings(@Body(new ZodValidationPipe(updatePrPreviewSettingsSchema)) body: UpdatePrPreviewSettingsInput): Promise<PrPreviewSettingsDto> {
		return this.prPreviewSettings.updateSettings(body);
	}
}
