import { Injectable } from '@nestjs/common';
import { CoreV1Api } from '@kubernetes/client-node';
import { getKubeConfig, parseMemoryToBytes, readPlatformVolumeUsage, type PlatformVolume, type PvcUsage } from '@kubwave/kube';
import { BackendConfigService } from '../../../../shared/config/backend-config.service.js';
import { MetricsConfigService } from '../../../../shared/metrics/metrics-config.service.js';
import { PlatformVolumeAutoscalingSettingsService } from '../volume-autoscaling/platform-volume-autoscaling-settings.service.js';
import type { PlatformVolumeDto, PlatformVolumesDto } from './platform-volumes.dto.js';

function toView(volume: PlatformVolume, usage: PvcUsage | null, capBytes: number | null): PlatformVolumeDto {
	return {
		volume,
		available: usage !== null,
		usedBytes: usage?.usedBytes ?? 0,
		capacityBytes: usage?.capacityBytes ?? 0,
		sampledAt: usage?.sampledAt ?? null,
		capBytes
	};
}

@Injectable()
export class PlatformVolumesService {
	constructor(
		private readonly config: BackendConfigService,
		private readonly metricsConfig: MetricsConfigService,
		private readonly volumeAutoscalingSettings: PlatformVolumeAutoscalingSettingsService
	) {}

	async getPlatformVolumes(): Promise<PlatformVolumesDto> {
		const sampledAt = new Date().toISOString();
		const settings = await this.volumeAutoscalingSettings.getSettings();
		const metrics = await this.metricsConfig.getMetricsProviderSettings();

		let usage: Record<PlatformVolume, PvcUsage | null> = { registry: null, postgres: null, prometheus: null };
		try {
			const coreApi = getKubeConfig().makeApiClient(CoreV1Api);
			usage = await readPlatformVolumeUsage(coreApi, this.config.api.podNamespace);
		} catch {
			// Cluster unreachable: keep the admin page useful with unavailable live fill.
		}

		const volumes: PlatformVolumeDto[] = [
			toView('postgres', usage.postgres, parseMemoryToBytes(settings.caps.postgres)),
			toView('registry', usage.registry, parseMemoryToBytes(settings.caps.registry))
		];
		if (metrics.provider === 'prometheus-managed') {
			volumes.push(toView('prometheus', usage.prometheus, parseMemoryToBytes(settings.caps.prometheus)));
		}

		return { sampledAt, volumes };
	}
}
