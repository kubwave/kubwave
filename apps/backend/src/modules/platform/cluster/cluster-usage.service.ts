import { Injectable } from '@nestjs/common';
import { MetricsConfigService } from '../../../shared/metrics/metrics-config.service.js';
import { pointsOf, queryRange, RANGES } from '../../../shared/metrics/prometheus-query.js';
import type { MetricsRange } from '../../../shared/metrics/prometheus.types.js';
import type { ClusterUsageDto } from './cluster.dto.js';

// cAdvisor's root cgroup (id="/") is the whole machine, the same scope as the kubelet node totals shown live.
const ROOT_CGROUP = 'id="/"';

@Injectable()
export class ClusterUsageService {
	constructor(private readonly metricsConfig: MetricsConfigService) {}

	// Cluster-wide without a node; one node's history (including its disk) with one.
	async getUsage(range: MetricsRange = '1h', node?: string): Promise<ClusterUsageDto> {
		const sampledAt = new Date().toISOString();
		const empty: ClusterUsageDto = { available: false, range, sampledAt, series: { cpuMillicores: [], memoryBytes: [], diskBytes: [] } };

		const baseUrl = this.metricsConfig.resolvePrometheusUrl(await this.metricsConfig.getMetricsProviderSettings());
		if (!baseUrl) return empty;

		const spec = RANGES[range];
		const end = Math.floor(Date.now() / 1000);
		const start = end - spec.windowSeconds;
		// The managed scrape config and kube-prometheus-stack both label cAdvisor series with `node`.
		const labels = node ? `${ROOT_CGROUP},node="${node}"` : ROOT_CGROUP;

		try {
			const [cpu, memory, disk] = await Promise.all([
				queryRange(baseUrl, `sum(rate(container_cpu_usage_seconds_total{${labels}}[${spec.rateWindow}])) * 1000`, start, end, spec.stepSeconds),
				queryRange(baseUrl, `sum(container_memory_working_set_bytes{${labels}})`, start, end, spec.stepSeconds),
				// cAdvisor reports the node rootfs under multiple device labels (e.g. the block device and its overlay mount);
				// max() reads the filesystem once, matching the kubelet total shown on the Nodes tab. sum() would double-count it.
				node ? queryRange(baseUrl, `max(container_fs_usage_bytes{${labels}})`, start, end, spec.stepSeconds) : Promise.resolve([])
			]);

			const cpuMillicores = pointsOf(cpu);
			const memoryBytes = pointsOf(memory);

			return {
				available: cpuMillicores.length > 0 || memoryBytes.length > 0,
				range,
				sampledAt,
				series: { cpuMillicores, memoryBytes, diskBytes: pointsOf(disk) }
			};
		} catch {
			return empty;
		}
	}
}
