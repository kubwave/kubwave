import { Injectable } from '@nestjs/common';
import { CoreV1Api } from '@kubernetes/client-node';
import { getKubeConfig } from '@kubwave/kube';
import type { ClusterEventsDto } from './cluster.dto.js';
import { toEventDto } from './event-mapper.js';

const MAX_EVENTS = 50;

@Injectable()
export class ClusterEventsService {
	async getEvents(): Promise<ClusterEventsDto> {
		const sampledAt = new Date().toISOString();

		try {
			const coreApi = getKubeConfig().makeApiClient(CoreV1Api);
			const list = await coreApi.listEventForAllNamespaces({ fieldSelector: 'type=Warning' });
			const events = list.items
				.map(toEventDto)
				.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
				.slice(0, MAX_EVENTS);

			return { available: true, sampledAt, events };
		} catch {
			// An unreachable cluster leaves the rest of the monitoring page usable.
			return { available: false, sampledAt, events: [] };
		}
	}
}
