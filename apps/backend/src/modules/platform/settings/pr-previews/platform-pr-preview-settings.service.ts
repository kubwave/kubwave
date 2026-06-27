import { Injectable } from '@nestjs/common';
import { PR_PREVIEW_SETTINGS_KEY, resolvePrPreviewSettings, type PrPreviewSettings } from '@kubwave/kube';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import type { PrPreviewSettingsDto, UpdatePrPreviewSettingsInput } from './platform-pr-preview-settings.dto.js';

@Injectable()
export class PlatformPrPreviewSettingsService {
	constructor(private readonly settings: SettingsService) {}

	async getSettings(): Promise<PrPreviewSettingsDto> {
		return resolvePrPreviewSettings(await this.settings.get<Partial<PrPreviewSettings>>(PR_PREVIEW_SETTINGS_KEY));
	}

	async updateSettings(input: UpdatePrPreviewSettingsInput): Promise<PrPreviewSettingsDto> {
		await this.settings.set<PrPreviewSettings>(PR_PREVIEW_SETTINGS_KEY, { maxPreviewsPerProject: input.maxPreviewsPerProject });
		return this.getSettings();
	}
}
