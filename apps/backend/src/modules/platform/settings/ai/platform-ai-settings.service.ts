import { Injectable } from '@nestjs/common';
import { encryptSecret } from '@kubwave/crypto';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import { AI_SETTINGS_KEY, type AiSettings } from '../../../services/analyze/llm.js';
import type { AiSettingsDto, UpdateAiSettingsInput } from './platform-ai-settings.dto.js';

@Injectable()
export class PlatformAiSettingsService {
	constructor(private readonly settings: SettingsService) {}

	async getSettings(): Promise<AiSettingsDto> {
		const stored = await this.settings.get<AiSettings>(AI_SETTINGS_KEY);
		return {
			enabled: stored?.enabled ?? false,
			provider: stored?.provider ?? 'anthropic',
			baseUrl: stored?.baseUrl ?? null,
			model: stored?.model ?? '',
			hasApiKey: Boolean(stored?.apiKeyCiphertext)
		};
	}

	async updateSettings(input: UpdateAiSettingsInput): Promise<AiSettingsDto> {
		const existing = await this.settings.get<AiSettings>(AI_SETTINGS_KEY);
		await this.settings.set<AiSettings>(AI_SETTINGS_KEY, {
			enabled: input.enabled,
			provider: input.provider,
			baseUrl: input.baseUrl || null,
			model: input.model,
			apiKeyCiphertext: input.apiKey ? encryptSecret(input.apiKey) : (existing?.apiKeyCiphertext ?? null)
		});
		return this.getSettings();
	}
}
