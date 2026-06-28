import { describe, expect, mock, test } from 'bun:test';
import type { BackendConfigService } from '~/shared/config/backend-config.service';
import type { MetricsConfigService as IMetricsConfigService } from '~/shared/metrics/metrics-config.service';
import type { SettingsService } from '~/shared/settings/settings.service';

// SettingsService (transitively loaded by MetricsConfigService) imports @kubwave/db at module
// level; stub it so this file can load without DATABASE_URL env vars.
mock.module('@kubwave/db', () => ({ db: {}, settings: {} }));

const { MetricsConfigService } = await import('~/shared/metrics/metrics-config.service');

// resolveProviderSettings / resolvePrometheusUrl are now MetricsConfigService methods. Build the
// service with stub deps; only resolvePrometheusUrl('managed') touches config (podNamespace).
function makeService(): IMetricsConfigService {
	const config = { api: { podNamespace: 'kubwave' } } as unknown as BackendConfigService;
	const settings = {} as unknown as SettingsService;
	return new MetricsConfigService(config, settings);
}

const service = makeService();

describe('resolveProviderSettings', () => {
	test('unconfigured installs default to live (no Prometheus footprint until an admin opts in)', () => {
		expect(service.resolveProviderSettings(null).provider).toBe('live');
		expect(service.resolveProviderSettings({}).provider).toBe('live');
	});

	test('an explicit provider choice is preserved', () => {
		expect(service.resolveProviderSettings({ provider: 'live' }).provider).toBe('live');
		const external = service.resolveProviderSettings({ provider: 'prometheus-external', prometheusUrl: 'http://prom:9090' });
		expect(external.provider).toBe('prometheus-external');
		expect(external.prometheusUrl).toBe('http://prom:9090');
	});
});

describe('resolvePrometheusUrl', () => {
	test('managed resolves to the in-cluster service URL', () => {
		expect(service.resolvePrometheusUrl({ provider: 'prometheus-managed', prometheusUrl: null })).toContain('kubwave-prometheus');
	});

	test('live has no Prometheus URL', () => {
		expect(service.resolvePrometheusUrl({ provider: 'live', prometheusUrl: null })).toBeNull();
	});
});
