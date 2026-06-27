import { Injectable } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { LABEL_SERVICE_ID, aggregateServiceUsage, emptyServiceUsage, environmentNamespace, getKubeConfig, nodeStatsSummary } from '@kubwave/kube';
import type { NodeStatsSummary, ServicePodRef, ServiceUsage, ServiceUsageLimits } from '@kubwave/kube';
import { MetricsConfigService } from '../../../shared/metrics/metrics-config.service.js';
import { ServicesService } from '../services.service.js';
import type { ServiceView } from '../services.types.js';
import type { MetricsRange, ServiceMetricsDto } from './metrics.dto.js';
import { PrometheusMetricsService } from './prometheus.service.js';

function toLiveMetrics(usage: ServiceUsage, sampledAt: string): ServiceMetricsDto {
	const t = Math.floor(Date.parse(sampledAt) / 1000);

	return {
		mode: 'live',
		available: usage.available,
		sampledAt,
		replicas: usage.replicas,
		current: {
			cpuMillicores: usage.cpuMillicores,
			memoryBytes: usage.memoryBytes,
			networkRxBytes: usage.networkRxBytes,
			networkTxBytes: usage.networkTxBytes,
			volumes: usage.volumes
		},
		limits: { cpuMillicores: usage.cpuLimitMillicores, memoryBytes: usage.memoryLimitBytes },
		series: {
			cpuMillicores: [{ t, v: usage.cpuMillicores }],
			memoryBytes: [{ t, v: usage.memoryBytes }],
			networkRxBytes: [],
			networkTxBytes: [],
			volumes: usage.volumes.map(volume => ({ name: volume.name, points: [{ t, v: volume.usedBytes }] }))
		}
	};
}

@Injectable()
export class ServiceMetricsService {
	constructor(
		private readonly metricsConfig: MetricsConfigService,
		private readonly prometheus: PrometheusMetricsService,
		private readonly services: ServicesService
	) {}

	async getServiceMetrics(actingUserId: string, serviceId: string, range: MetricsRange = '1h'): Promise<ServiceMetricsDto> {
		const service = await this.services.getService(actingUserId, serviceId);
		const prometheusUrl = this.metricsConfig.resolvePrometheusUrl(await this.metricsConfig.getMetricsProviderSettings());

		if (prometheusUrl) {
			try {
				return await this.prometheus.getServiceMetrics({ baseUrl: prometheusUrl, service, serviceId, range });
			} catch {
				// Fall back to the live kubelet snapshot when Prometheus is unreachable or misconfigured.
			}
		}

		return this.getLiveServiceMetrics(service, serviceId);
	}

	private async getLiveServiceMetrics(service: ServiceView, serviceId: string): Promise<ServiceMetricsDto> {
		const limits: ServiceUsageLimits = { cpuLimit: service.config.resources?.cpuLimit, memoryLimit: service.config.resources?.memoryLimit };
		const sampledAt = new Date().toISOString();

		try {
			const api = this.coreApi();
			const namespace = environmentNamespace(service.environmentId);
			const podList = await api.listNamespacedPod({ namespace, labelSelector: `${LABEL_SERVICE_ID}=${serviceId}` });
			const pods: ServicePodRef[] = podList.items
				.map(pod => ({ name: pod.metadata?.name ?? '', nodeName: pod.spec?.nodeName ?? null }))
				.filter(pod => pod.name.length > 0);

			if (pods.length === 0) return toLiveMetrics(emptyServiceUsage(limits), sampledAt);

			const nodes = [...new Set(pods.map(pod => pod.nodeName).filter((node): node is string => Boolean(node)))];
			const summaries: NodeStatsSummary[] = [];

			for (const node of nodes) {
				try {
					summaries.push(await nodeStatsSummary(api, node));
				} catch {
					// Skip only this node. Other nodes can still contribute metrics.
				}
			}

			return toLiveMetrics(aggregateServiceUsage({ serviceId, namespace, pods, summaries, limits }), sampledAt);
		} catch {
			return toLiveMetrics(emptyServiceUsage(limits), sampledAt);
		}
	}

	private coreApi(): k8s.CoreV1Api {
		return getKubeConfig().makeApiClient(k8s.CoreV1Api);
	}
}
