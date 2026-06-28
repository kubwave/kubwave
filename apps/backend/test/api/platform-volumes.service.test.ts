import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { BackendConfigService } from '~/shared/config/backend-config.service';
import type { MetricsConfigService } from '~/shared/metrics/metrics-config.service';
import type { PlatformVolumeAutoscalingSettingsService } from '~/modules/platform/settings/volume-autoscaling/platform-volume-autoscaling-settings.service';

type Provider = 'live' | 'prometheus-external' | 'prometheus-managed';
type Usage = { usedBytes: number; capacityBytes: number; sampledAt?: string } | null;

let metricsProvider: Provider = 'live';
let platformUsage: { postgres: Usage; registry: Usage; prometheus: Usage } = {
	postgres: { usedBytes: 10, capacityBytes: 100 },
	registry: { usedBytes: 20, capacityBytes: 100, sampledAt: '2026-06-20T19:25:29Z' },
	prometheus: { usedBytes: 30, capacityBytes: 100 }
};

function parseMemoryToBytes(value: string | undefined | null): number | null {
	if (!value?.endsWith('Gi')) return null;
	return Number(value.slice(0, -2)) * 1024 ** 3;
}

// PlatformVolumesService → MetricsConfigService / PlatformVolumeAutoscalingSettingsService →
// SettingsService → @kubwave/db (top-level createClient call). Stub it so this file can load
// without DATABASE_URL env vars.
mock.module('@kubwave/db', () => ({ db: {}, settings: {} }));

mock.module('@kubwave/kube', () => ({
	DEFAULT_METRICS_PROVIDER: 'live',
	METRICS_SETTINGS_KEY: 'metrics-provider',
	VOLUME_AUTOSCALING_SETTINGS_KEY: 'volume-autoscaling',
	getKubeConfig: () => ({ makeApiClient: () => ({}) }),
	parseMemoryToBytes,
	readPlatformVolumeUsage: async () => platformUsage,
	resolveVolumeAutoscaling: (value: unknown) => {
		const v = (value ?? {}) as { enabled?: boolean; thresholdPercent?: number; growthPercent?: number; caps?: Record<string, string> };
		return {
			enabled: v.enabled ?? false,
			thresholdPercent: v.thresholdPercent ?? 80,
			growthPercent: v.growthPercent ?? 50,
			caps: {
				postgres: v.caps?.postgres ?? '100Gi',
				registry: v.caps?.registry ?? '200Gi',
				prometheus: v.caps?.prometheus ?? '50Gi'
			}
		};
	}
}));

const { PlatformVolumesService } = await import('~/modules/platform/settings/platform-volumes/platform-volumes.service');

// getPlatformVolumes is now a PlatformVolumesService method. Inject stub config + the two
// settings services it reads; @kubwave/kube (kube client + usage reader) is mocked above.
function makeService(): InstanceType<typeof PlatformVolumesService> {
	const config = { api: { podNamespace: 'kubwave' } } as unknown as BackendConfigService;
	const metricsConfig = {
		getMetricsProviderSettings: async () => ({ provider: metricsProvider, prometheusUrl: null })
	} as unknown as MetricsConfigService;
	const volumeAutoscalingSettings = {
		getSettings: async () => ({
			enabled: false,
			thresholdPercent: 80,
			growthPercent: 50,
			caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' }
		})
	} as unknown as PlatformVolumeAutoscalingSettingsService;
	return new PlatformVolumesService(config, metricsConfig, volumeAutoscalingSettings);
}

afterEach(() => {
	metricsProvider = 'live';
	platformUsage = {
		postgres: { usedBytes: 10, capacityBytes: 100 },
		registry: { usedBytes: 20, capacityBytes: 100, sampledAt: '2026-06-20T19:25:29Z' },
		prometheus: { usedBytes: 30, capacityBytes: 100 }
	};
});

describe('getPlatformVolumes', () => {
	test('omits prometheus unless the managed metrics provider is active', async () => {
		metricsProvider = 'live';
		const res = await makeService().getPlatformVolumes();
		expect(res.volumes.map(v => v.volume)).toEqual(['postgres', 'registry']);
	});

	test('includes prometheus for managed metrics even before kubelet usage is available', async () => {
		metricsProvider = 'prometheus-managed';
		platformUsage = { ...platformUsage, prometheus: null };

		const res = await makeService().getPlatformVolumes();
		const prometheus = res.volumes.find(v => v.volume === 'prometheus');

		expect(res.volumes.map(v => v.volume)).toEqual(['postgres', 'registry', 'prometheus']);
		expect(prometheus).toMatchObject({ available: false, usedBytes: 0, capacityBytes: 0, capBytes: 50 * 1024 ** 3 });
	});

	test('exposes the kubelet sample timestamp per volume', async () => {
		const res = await makeService().getPlatformVolumes();
		const registry = res.volumes.find(v => v.volume === 'registry');
		const postgres = res.volumes.find(v => v.volume === 'postgres');

		expect(registry?.sampledAt).toBe('2026-06-20T19:25:29Z');
		expect(postgres?.sampledAt).toBeNull();
	});
});
