import { Injectable } from '@nestjs/common';
import { CoreV1Api, type CoreV1Event } from '@kubernetes/client-node';
import { getKubeConfig } from '@kubwave/kube';
import type { ClusterEventDto, ClusterEventsDto } from './cluster.dto.js';

const MAX_EVENTS = 50;

function occurredAt(event: CoreV1Event): string | null {
	const value = event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp;
	if (!value) return null;
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toEventDto(event: CoreV1Event): ClusterEventDto {
	const namespace = event.metadata?.namespace ?? null;

	return {
		id: event.metadata?.uid ?? `${namespace ?? ''}/${event.metadata?.name ?? ''}`,
		reason: event.reason ?? '',
		message: event.message ?? '',
		namespace,
		objectKind: event.involvedObject?.kind ?? null,
		objectName: event.involvedObject?.name ?? null,
		count: event.count ?? 1,
		lastSeen: occurredAt(event)
	};
}

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
