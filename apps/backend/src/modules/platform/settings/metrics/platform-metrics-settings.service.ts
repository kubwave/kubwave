import { Injectable } from '@nestjs/common';
import { MetricsConfigService, METRICS_SETTINGS_KEY, type MetricsProviderSettings } from '../../../../shared/metrics/metrics-config.service.js';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import type { MetricsSettingsDto, UpdateMetricsSettingsInput } from './platform-metrics-settings.dto.js';

@Injectable()
export class PlatformMetricsSettingsService {
	constructor(
		private readonly metricsConfig: MetricsConfigService,
		private readonly settings: SettingsService
	) {}

	async getSettings(): Promise<MetricsSettingsDto> {
		const settings = await this.metricsConfig.getMetricsProviderSettings();
		return { provider: settings.provider, prometheusUrl: settings.prometheusUrl };
	}

	async updateSettings(input: UpdateMetricsSettingsInput): Promise<MetricsSettingsDto> {
		const next: MetricsProviderSettings = {
			provider: input.provider,
			prometheusUrl: input.provider === 'prometheus-external' ? (input.prometheusUrl?.trim() ?? null) : null
		};
		await this.settings.set<MetricsProviderSettings>(METRICS_SETTINGS_KEY, next);
		return this.getSettings();
	}
}
