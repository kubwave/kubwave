import type { CoreV1Event } from '@kubernetes/client-node';
import type { ClusterEventDto } from './cluster.dto.js';

// events.k8s.io writers (e.g. the scheduler's FailedScheduling) track repeats in `series` and leave lastTimestamp/count unset.
function occurredAt(event: CoreV1Event): string | null {
	const value = event.series?.lastObservedTime ?? event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp;
	if (!value) return null;
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toEventDto(event: CoreV1Event): ClusterEventDto {
	return {
		id: event.metadata?.uid ?? `${event.metadata?.namespace ?? ''}/${event.metadata?.name ?? ''}`,
		reason: event.reason ?? '',
		message: event.message ?? '',
		// The object's namespace, not the Event's: events about cluster-scoped objects like Nodes land in "default".
		namespace: event.involvedObject?.namespace || null,
		objectKind: event.involvedObject?.kind ?? null,
		objectName: event.involvedObject?.name ?? null,
		count: event.series?.count ?? event.count ?? 1,
		lastSeen: occurredAt(event)
	};
}

export function byLastSeen(a: ClusterEventDto, b: ClusterEventDto): number {
	return (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '');
}
