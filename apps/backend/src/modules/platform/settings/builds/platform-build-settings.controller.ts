import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { BUILD_SETTINGS_KEY, buildSettingsSchema, type BuildSettings } from '../../../../shared/builds/settings.js';
import { getBuildSettings } from '../../../../shared/builds/build-settings.service.js';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import { BuildSettingsDto } from './platform-build-settings.dto.js';

@ApiTags('platform-settings')
@Controller('platform/settings/builds')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformBuildSettingsController {
	constructor(private readonly settings: SettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsBuildsGet', summary: 'Get build execution and resource settings' })
	@ApiOkResponse({ type: BuildSettingsDto })
	get(): Promise<BuildSettingsDto> {
		return getBuildSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsBuildsUpdate', summary: 'Configure new builds' })
	@ApiBody({ type: BuildSettingsDto })
	@ApiOkResponse({ type: BuildSettingsDto })
	async update(@Body(new ZodValidationPipe(buildSettingsSchema)) body: BuildSettings): Promise<BuildSettingsDto> {
		await this.settings.set(BUILD_SETTINGS_KEY, body);
		return body;
	}
}
