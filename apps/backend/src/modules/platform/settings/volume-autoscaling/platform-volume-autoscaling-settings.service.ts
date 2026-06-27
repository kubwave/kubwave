import { Injectable } from '@nestjs/common';
import { VOLUME_AUTOSCALING_SETTINGS_KEY, resolveVolumeAutoscaling, type VolumeAutoscalingSettings } from '@kubwave/kube';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import type { VolumeAutoscalingSettingsDto, VolumeAutoscalingSettingsInput } from './platform-volume-autoscaling-settings.dto.js';

@Injectable()
export class PlatformVolumeAutoscalingSettingsService {
	constructor(private readonly settings: SettingsService) {}

	async getSettings(): Promise<VolumeAutoscalingSettingsDto> {
		return resolveVolumeAutoscaling(await this.settings.get<Partial<VolumeAutoscalingSettings>>(VOLUME_AUTOSCALING_SETTINGS_KEY));
	}

	async updateSettings(input: VolumeAutoscalingSettingsInput): Promise<VolumeAutoscalingSettingsDto> {
		await this.settings.set<VolumeAutoscalingSettings>(VOLUME_AUTOSCALING_SETTINGS_KEY, input);
		return this.getSettings();
	}
}
