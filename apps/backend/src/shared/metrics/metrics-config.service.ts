import { Injectable } from '@nestjs/common';
import { DEFAULT_METRICS_PROVIDER, METRICS_SETTINGS_KEY } from '@kubwave/kube';
import { BackendConfigService } from '../config/backend-config.service.js';
import { SettingsService } from '../settings/settings.service.js';

export { METRICS_SETTINGS_KEY };

export type MetricsProvider = 'live' | 'prometheus-external' | 'prometheus-managed';

export interface MetricsProviderSettings {
	provider: MetricsProvider;
	prometheusUrl: string | null;
}

@Injectable()
export class MetricsConfigService {
	constructor(
		private readonly config: BackendConfigService,
		private readonly settings: SettingsService
	) {}

	managedPrometheusUrl(): string {
		return `http://kubwave-prometheus.${this.config.api.podNamespace}.svc:9090`;
	}

	resolveProviderSettings(stored: Partial<MetricsProviderSettings> | null): MetricsProviderSettings {
		return {
			provider: stored?.provider ?? (DEFAULT_METRICS_PROVIDER as MetricsProvider),
			prometheusUrl: stored?.prometheusUrl ?? null
		};
	}

	async getMetricsProviderSettings(): Promise<MetricsProviderSettings> {
		return this.resolveProviderSettings(await this.settings.get<Partial<MetricsProviderSettings>>(METRICS_SETTINGS_KEY));
	}

	resolvePrometheusUrl(settings: MetricsProviderSettings): string | null {
		if (settings.provider === 'prometheus-external') return settings.prometheusUrl?.trim() || null;
		if (settings.provider === 'prometheus-managed') return this.managedPrometheusUrl();
		return null;
	}
}
