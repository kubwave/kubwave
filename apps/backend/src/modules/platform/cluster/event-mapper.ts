import type { CoreV1Event } from '@kubernetes/client-node';
import type { ClusterEventDto } from './cluster.dto.js';

export function occurredAt(event: CoreV1Event): string | null {
	const value = event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp;
	if (!value) return null;
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toEventDto(event: CoreV1Event): ClusterEventDto {
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
