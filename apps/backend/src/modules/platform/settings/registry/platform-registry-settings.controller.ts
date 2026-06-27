import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import {
	ExternalRegistrySettingsDto,
	PlatformRegistryModeDto,
	RegistrySettingsDto,
	updateRegistrySettingsSchema,
	type UpdateRegistrySettingsInput
} from './platform-registry-settings.dto.js';
import { PlatformRegistrySettingsService } from './platform-registry-settings.service.js';

@ApiTags('platform-settings')
@ApiExtraModels(PlatformRegistryModeDto, ExternalRegistrySettingsDto)
@Controller('platform/settings/registry')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformRegistrySettingsController {
	constructor(private readonly registrySettings: PlatformRegistrySettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsRegistryGet', summary: 'Get build registry settings' })
	@ApiOkResponse({ type: RegistrySettingsDto })
	getSettings(): Promise<RegistrySettingsDto> {
		return this.registrySettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsRegistryUpdate', summary: 'Update build registry settings' })
	@ApiBody({
		schema: {
			oneOf: [{ $ref: getSchemaPath(PlatformRegistryModeDto) }, { $ref: getSchemaPath(ExternalRegistrySettingsDto) }],
			discriminator: {
				propertyName: 'mode',
				mapping: {
					platform: getSchemaPath(PlatformRegistryModeDto),
					external: getSchemaPath(ExternalRegistrySettingsDto)
				}
			}
		}
	})
	@ApiOkResponse({ type: RegistrySettingsDto })
	updateSettings(@Body(new ZodValidationPipe(updateRegistrySettingsSchema)) body: UpdateRegistrySettingsInput): Promise<RegistrySettingsDto> {
		return this.registrySettings.updateSettings(body);
	}
}
