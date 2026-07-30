import { Injectable } from '@nestjs/common';
import { MetricsConfigService } from '../../../shared/metrics/metrics-config.service.js';
import { pointsOf, queryRange, RANGES } from '../../../shared/metrics/prometheus-query.js';
import type { MetricsRange } from '../../../shared/metrics/prometheus.types.js';
import type { ClusterNodeUsageDto } from './cluster.dto.js';

const CONTAINER_LABELS = 'container!="",container!="POD"';

// instance from role:node matches the param; kubernetes_io_hostname diverges under --hostname-override
function nodeSelector(name: string): string {
	return `instance="${name}"`;
}

@Injectable()
export class ClusterNodeUsageService {
	constructor(private readonly metricsConfig: MetricsConfigService) {}

	async getUsage(name: string, range: MetricsRange = '1h'): Promise<ClusterNodeUsageDto> {
		const sampledAt = new Date().toISOString();
		const empty: ClusterNodeUsageDto = {
			available: false,
			range,
			sampledAt,
			series: { cpuMillicores: [], memoryBytes: [], diskBytes: [] }
		};

		const baseUrl = this.metricsConfig.resolvePrometheusUrl(await this.metricsConfig.getMetricsProviderSettings());
		if (!baseUrl) return empty;

		const spec = RANGES[range];
		const end = Math.floor(Date.now() / 1000);
		const start = end - spec.windowSeconds;
		const node = nodeSelector(name);

		try {
			const [cpu, memory, disk] = await Promise.all([
				queryRange(
					baseUrl,
					`sum(rate(container_cpu_usage_seconds_total{${node},${CONTAINER_LABELS}}[${spec.rateWindow}])) * 1000`,
					start,
					end,
					spec.stepSeconds
				),
				queryRange(baseUrl, `sum(container_memory_working_set_bytes{${node},${CONTAINER_LABELS}})`, start, end, spec.stepSeconds),
				queryRange(baseUrl, `sum(container_fs_usage_bytes{${node},id="/"})`, start, end, spec.stepSeconds)
			]);

			const cpuMillicores = pointsOf(cpu);
			const memoryBytes = pointsOf(memory);
			const diskBytes = pointsOf(disk);

			return {
				available: cpuMillicores.length > 0 || memoryBytes.length > 0,
				range,
				sampledAt,
				series: { cpuMillicores, memoryBytes, diskBytes }
			};
		} catch {
			return empty;
		}
	}
}
