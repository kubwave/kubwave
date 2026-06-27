import { Injectable } from '@nestjs/common';
import { environmentNamespace, parseCpuToMillicores, parseMemoryToBytes, pvcName, resourceName, serviceVolumeNameFromPvc } from '@kubwave/kube';
import type { ServiceView } from '../services.types.js';
import type { ServiceMetricsDto } from './metrics.dto.js';
import type { MetricsRange, PrometheusMetricPoint, PromMatrixResult, RangeSpec } from './prometheus.types.js';

const RANGES: Record<MetricsRange, RangeSpec> = {
	'1h': { windowSeconds: 3600, stepSeconds: 10, rateWindow: '1m' },
	'24h': { windowSeconds: 86_400, stepSeconds: 600, rateWindow: '30m' },
	'7d': { windowSeconds: 604_800, stepSeconds: 900, rateWindow: '30m' }
};

function pointsOf(result: PromMatrixResult[] | undefined): PrometheusMetricPoint[] {
	const series = result?.[0];
	if (!series) return [];
	return series.values.map(([t, v]) => ({ t, v: Number(v) })).filter(point => Number.isFinite(point.v));
}

function lastValue(points: PrometheusMetricPoint[]): number {
	return points.length > 0 ? points[points.length - 1]!.v : 0;
}

@Injectable()
export class PrometheusMetricsService {
	async getServiceMetrics(args: { baseUrl: string; service: ServiceView; serviceId: string; range: MetricsRange }): Promise<ServiceMetricsDto> {
		const { baseUrl, service, serviceId, range } = args;
		const namespace = environmentNamespace(service.environmentId);
		const podRe = `${resourceName(serviceId)}-.*`;
		const pvcRe = `${pvcName(serviceId, '')}.*`;
		const labels = `namespace="${namespace}",pod=~"${podRe}"`;
		const containerLabels = `${labels},container!="",container!="POD"`;
		const pvcLabels = `namespace="${namespace}",persistentvolumeclaim=~"${pvcRe}"`;

		const spec = RANGES[range];
		const end = Math.floor(Date.now() / 1000);
		const start = end - spec.windowSeconds;
		const step = spec.stepSeconds;
		const rw = spec.rateWindow;

		const [cpu, memory, networkRx, networkTx, pvcUsed, pvcCapacity] = await Promise.all([
			this.queryRange(baseUrl, `sum(rate(container_cpu_usage_seconds_total{${containerLabels}}[${rw}])) * 1000`, start, end, step),
			this.queryRange(baseUrl, `sum(container_memory_working_set_bytes{${containerLabels}})`, start, end, step),
			this.queryRange(baseUrl, `sum(rate(container_network_receive_bytes_total{${labels}}[${rw}]))`, start, end, step),
			this.queryRange(baseUrl, `sum(rate(container_network_transmit_bytes_total{${labels}}[${rw}]))`, start, end, step),
			this.queryRange(baseUrl, `kubelet_volume_stats_used_bytes{${pvcLabels}}`, start, end, step),
			this.queryRange(baseUrl, `kubelet_volume_stats_capacity_bytes{${pvcLabels}}`, start, end, step)
		]);

		const cpuPoints = pointsOf(cpu);
		const memoryPoints = pointsOf(memory);
		const networkRxPoints = pointsOf(networkRx);
		const networkTxPoints = pointsOf(networkTx);

		const capacityByVolume = new Map<string, number>();
		for (const series of pvcCapacity) {
			const name = serviceVolumeNameFromPvc(serviceId, series.metric.persistentvolumeclaim);
			if (name) capacityByVolume.set(name, lastValue(pointsOf([series])));
		}

		const volumeSeries: Array<{ name: string; points: PrometheusMetricPoint[] }> = [];
		const volumesCurrent: Array<{ name: string; usedBytes: number; capacityBytes: number }> = [];
		for (const series of pvcUsed) {
			const name = serviceVolumeNameFromPvc(serviceId, series.metric.persistentvolumeclaim);
			if (!name) continue;

			const points = pointsOf([series]);
			volumeSeries.push({ name, points });
			volumesCurrent.push({ name, usedBytes: lastValue(points), capacityBytes: capacityByVolume.get(name) ?? 0 });
		}

		volumeSeries.sort((a, b) => a.name.localeCompare(b.name));
		volumesCurrent.sort((a, b) => a.name.localeCompare(b.name));

		const available =
			cpuPoints.length > 0 || memoryPoints.length > 0 || networkRxPoints.length > 0 || networkTxPoints.length > 0 || volumesCurrent.length > 0;

		return {
			mode: 'historical',
			available,
			sampledAt: new Date().toISOString(),
			replicas: 0,
			current: {
				cpuMillicores: lastValue(cpuPoints),
				memoryBytes: lastValue(memoryPoints),
				networkRxBytes: lastValue(networkRxPoints),
				networkTxBytes: lastValue(networkTxPoints),
				volumes: volumesCurrent
			},
			limits: {
				cpuMillicores: parseCpuToMillicores(service.config.resources?.cpuLimit),
				memoryBytes: parseMemoryToBytes(service.config.resources?.memoryLimit)
			},
			series: {
				cpuMillicores: cpuPoints,
				memoryBytes: memoryPoints,
				networkRxBytes: networkRxPoints,
				networkTxBytes: networkTxPoints,
				volumes: volumeSeries
			}
		};
	}

	private async queryRange(baseUrl: string, query: string, start: number, end: number, step: number): Promise<PromMatrixResult[]> {
		const url = new URL('/api/v1/query_range', baseUrl);
		url.searchParams.set('query', query);
		url.searchParams.set('start', String(start));
		url.searchParams.set('end', String(end));
		url.searchParams.set('step', String(step));

		const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
		if (!response.ok) throw new Error(`Prometheus query failed: ${response.status}`);

		const body = (await response.json()) as { status?: string; data?: { result?: PromMatrixResult[] } };
		if (body.status !== 'success') throw new Error('Prometheus query returned non-success status');

		return body.data?.result ?? [];
	}
}
