import { Injectable } from '@nestjs/common';
import { MetricsConfigService } from '../../../shared/metrics/metrics-config.service.js';
import { pointsOf, queryRange, RANGES } from '../../../shared/metrics/prometheus-query.js';
import type { MetricsRange } from '../../../shared/metrics/prometheus.types.js';
import type { ClusterUsageDto } from './cluster.dto.js';

// cAdvisor is the only scrape source, so these are container sums and read below the kubelet's node totals.
const CONTAINER_LABELS = 'container!="",container!="POD"';

@Injectable()
export class ClusterUsageService {
	constructor(private readonly metricsConfig: MetricsConfigService) {}

	async getUsage(range: MetricsRange = '1h'): Promise<ClusterUsageDto> {
		const sampledAt = new Date().toISOString();
		const empty: ClusterUsageDto = { available: false, range, sampledAt, series: { cpuMillicores: [], memoryBytes: [] } };

		const baseUrl = this.metricsConfig.resolvePrometheusUrl(await this.metricsConfig.getMetricsProviderSettings());
		if (!baseUrl) return empty;

		const spec = RANGES[range];
		const end = Math.floor(Date.now() / 1000);
		const start = end - spec.windowSeconds;

		try {
			const [cpu, memory] = await Promise.all([
				queryRange(
					baseUrl,
					`sum(rate(container_cpu_usage_seconds_total{${CONTAINER_LABELS}}[${spec.rateWindow}])) * 1000`,
					start,
					end,
					spec.stepSeconds
				),
				queryRange(baseUrl, `sum(container_memory_working_set_bytes{${CONTAINER_LABELS}})`, start, end, spec.stepSeconds)
			]);

			const cpuMillicores = pointsOf(cpu);
			const memoryBytes = pointsOf(memory);

			return {
				available: cpuMillicores.length > 0 || memoryBytes.length > 0,
				range,
				sampledAt,
				series: { cpuMillicores, memoryBytes }
			};
		} catch {
			return empty;
		}
	}
}
