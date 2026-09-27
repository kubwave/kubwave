import { Injectable, Logger } from '@nestjs/common';
import { CoreV1Api } from '@kubernetes/client-node';
import { getKubeConfig } from '@kubwave/kube';
import type { ClusterEventsDto } from './cluster.dto.js';
import { byLastSeen, toEventDto } from './event-mapper.js';

const MAX_EVENTS = 50;
const CACHE_TTL_MS = 10_000;

@Injectable()
export class ClusterEventsService {
	private readonly logger = new Logger(ClusterEventsService.name);
	private cache: { at: number; value: ClusterEventsDto } | null = null;

	async getEvents(): Promise<ClusterEventsDto> {
		const cached = this.cache;
		if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

		const value = await this.read();
		this.cache = { at: Date.now(), value };

		return value;
	}

	private async read(): Promise<ClusterEventsDto> {
		const sampledAt = new Date().toISOString();

		try {
			const coreApi = getKubeConfig().makeApiClient(CoreV1Api);
			// resourceVersion 0 lets the apiserver answer from its watch cache instead of a full etcd read.
			const list = await coreApi.listEventForAllNamespaces({ fieldSelector: 'type=Warning', resourceVersion: '0' });
			const events = list.items.map(toEventDto).sort(byLastSeen).slice(0, MAX_EVENTS);

			return { available: true, sampledAt, events };
		} catch (error) {
			// An unreachable cluster leaves the rest of the monitoring page usable.
			this.logger.warn(`Cluster events unavailable: ${error instanceof Error ? error.message : String(error)}`);
			return { available: false, sampledAt, events: [] };
		}
	}
}
