import { Injectable } from '@nestjs/common';
import { HA_SETTINGS_KEY, resolveHaSettings, type HaSettings } from '@kubwave/kube';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import type { HaSettingsDto, UpdateHaSettingsInput } from './platform-ha-settings.dto.js';

@Injectable()
export class PlatformHaSettingsService {
	constructor(private readonly settings: SettingsService) {}

	async getSettings(): Promise<HaSettingsDto> {
		return resolveHaSettings(await this.settings.get<Partial<HaSettings>>(HA_SETTINGS_KEY));
	}

	async updateSettings(input: UpdateHaSettingsInput): Promise<HaSettingsDto> {
		await this.settings.set<HaSettings>(HA_SETTINGS_KEY, { enabled: input.enabled });
		return this.getSettings();
	}
}
