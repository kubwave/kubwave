import { Injectable } from '@nestjs/common';
import {
	DEFAULT_DOMAIN_RUNTIME_KEY,
	DEFAULT_DOMAIN_SETTINGS_KEY,
	effectiveBase,
	resolveDefaultDomainRuntime,
	resolveDefaultDomainSettings,
	type DefaultDomainSettings
} from '@kubwave/db';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import type { DefaultDomainSettingsDto, UpdateDefaultDomainSettingsInput } from './platform-domain-settings.dto.js';

@Injectable()
export class PlatformDomainSettingsService {
	constructor(private readonly settings: SettingsService) {}

	async getSettings(): Promise<DefaultDomainSettingsDto> {
		const [storedSettings, storedRuntime] = await Promise.all([
			this.settings.get<Partial<DefaultDomainSettings>>(DEFAULT_DOMAIN_SETTINGS_KEY),
			this.settings.get<Partial<Parameters<typeof resolveDefaultDomainRuntime>[0]>>(DEFAULT_DOMAIN_RUNTIME_KEY)
		]);
		const settings = resolveDefaultDomainSettings(storedSettings);
		const runtime = resolveDefaultDomainRuntime(storedRuntime);

		return {
			mode: settings.mode,
			base: settings.base,
			subdomainTemplate: settings.subdomainTemplate,
			effectiveBase: effectiveBase(settings, runtime)
		};
	}

	async updateSettings(input: UpdateDefaultDomainSettingsInput): Promise<DefaultDomainSettingsDto> {
		const next: DefaultDomainSettings = {
			mode: input.mode,
			base: input.mode === 'wildcard' ? (input.base?.trim() ?? null) : null,
			subdomainTemplate: input.subdomainTemplate?.trim() || null
		};

		await this.settings.set<DefaultDomainSettings>(DEFAULT_DOMAIN_SETTINGS_KEY, next);
		return this.getSettings();
	}
}
