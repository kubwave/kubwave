import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import {
	DefaultDomainSettingsDto,
	UpdateDefaultDomainSettingsDto,
	updateDefaultDomainSettingsSchema,
	type UpdateDefaultDomainSettingsInput
} from './platform-domain-settings.dto.js';
import { PlatformDomainSettingsService } from './platform-domain-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/domain')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformDomainSettingsController {
	constructor(private readonly domainSettings: PlatformDomainSettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsDomainGet', summary: 'Get default-domain settings' })
	@ApiOkResponse({ type: DefaultDomainSettingsDto })
	getSettings(): Promise<DefaultDomainSettingsDto> {
		return this.domainSettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsDomainUpdate', summary: 'Update default-domain settings' })
	@ApiBody({ type: UpdateDefaultDomainSettingsDto })
	@ApiOkResponse({ type: DefaultDomainSettingsDto })
	updateSettings(
		@Body(new ZodValidationPipe(updateDefaultDomainSettingsSchema)) body: UpdateDefaultDomainSettingsInput
	): Promise<DefaultDomainSettingsDto> {
		return this.domainSettings.updateSettings(body);
	}
}
