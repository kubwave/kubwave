import { Injectable } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { LABEL_SERVICE_ID, environmentNamespace, getKubeConfig } from '@kubwave/kube';
import { ServicesService } from '../services.service.js';
import type { ServiceLogsDto, ServiceLogsOptions } from './logs.dto.js';
import { mergeAndSortEntries, parsePodLog } from './logs.parse.js';

const MAX_PODS = 10;
const DEFAULT_TAIL_LINES = 200;
const MAX_TAIL_LINES = 2000;

function clampTail(tailLines: number | undefined): number {
	if (tailLines == null || !Number.isFinite(tailLines)) return DEFAULT_TAIL_LINES;
	return Math.min(Math.max(Math.trunc(tailLines), 1), MAX_TAIL_LINES);
}

@Injectable()
export class ServiceLogsService {
	constructor(private readonly services: ServicesService) {}

	async getServiceLogs(actingUserId: string, serviceId: string, opts: ServiceLogsOptions = {}): Promise<ServiceLogsDto> {
		const service = await this.services.getService(actingUserId, serviceId);
		const tailLines = clampTail(opts.tailLines);

		try {
			const api = this.coreApi();
			const namespace = environmentNamespace(service.environmentId);
			const podList = await api.listNamespacedPod({ namespace, labelSelector: `${LABEL_SERVICE_ID}=${serviceId}` });
			const allPods = podList.items.map(pod => pod.metadata?.name ?? '').filter(name => name.length > 0);
			if (allPods.length === 0) return { available: false, pods: [], entries: [] };

			const targets = opts.pod && allPods.includes(opts.pod) ? [opts.pod] : allPods.slice(0, MAX_PODS);
			const groups = await Promise.all(
				targets.map(async name => {
					try {
						const raw = await api.readNamespacedPodLog({ name, namespace, timestamps: true, tailLines });
						return parsePodLog(typeof raw === 'string' ? raw : String(raw), name);
					} catch {
						return [];
					}
				})
			);

			return { available: true, pods: allPods, entries: mergeAndSortEntries(groups) };
		} catch {
			return { available: false, pods: [], entries: [] };
		}
	}

	private coreApi(): k8s.CoreV1Api {
		return getKubeConfig().makeApiClient(k8s.CoreV1Api);
	}
}
