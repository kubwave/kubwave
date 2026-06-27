import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import {
	VolumeAutoscalingSettingsDto,
	volumeAutoscalingSettingsSchema,
	type VolumeAutoscalingSettingsInput
} from './platform-volume-autoscaling-settings.dto.js';
import { PlatformVolumeAutoscalingSettingsService } from './platform-volume-autoscaling-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/volume-autoscaling')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformVolumeAutoscalingSettingsController {
	constructor(private readonly volumeAutoscalingSettings: PlatformVolumeAutoscalingSettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsVolumeAutoscalingGet', summary: 'Get platform volume autoscaling settings' })
	@ApiOkResponse({ type: VolumeAutoscalingSettingsDto })
	getSettings(): Promise<VolumeAutoscalingSettingsDto> {
		return this.volumeAutoscalingSettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsVolumeAutoscalingUpdate', summary: 'Update platform volume autoscaling settings' })
	@ApiBody({ type: VolumeAutoscalingSettingsDto })
	@ApiOkResponse({ type: VolumeAutoscalingSettingsDto })
	updateSettings(
		@Body(new ZodValidationPipe(volumeAutoscalingSettingsSchema)) body: VolumeAutoscalingSettingsInput
	): Promise<VolumeAutoscalingSettingsDto> {
		return this.volumeAutoscalingSettings.updateSettings(body);
	}
}
