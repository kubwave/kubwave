import { beforeEach, describe, expect, mock, test } from 'bun:test';

interface EventItem {
	metadata?: { uid?: string; name?: string; namespace?: string; creationTimestamp?: string };
	reason?: string;
	message?: string;
	involvedObject?: { kind?: string; name?: string };
	count?: number;
	lastTimestamp?: string;
}

let events: EventItem[] = [];
let listThrows = false;
let lastFieldSelector: string | undefined;

function warning(reason: string, lastTimestamp: string, overrides: Partial<EventItem> = {}): EventItem {
	return {
		metadata: { uid: `uid-${reason}`, name: `event-${reason}`, namespace: 'kubwave' },
		reason,
		message: `${reason} happened`,
		involvedObject: { kind: 'Pod', name: 'api-1' },
		count: 1,
		lastTimestamp,
		...overrides
	};
}

mock.module('@kubwave/db', () => ({ db: {}, settings: {} }));

mock.module('@kubwave/kube', () => ({
	getKubeConfig: () => ({
		makeApiClient: () => ({
			listEventForAllNamespaces: async ({ fieldSelector }: { fieldSelector?: string }) => {
				lastFieldSelector = fieldSelector;
				if (listThrows) throw new Error('unreachable');
				return { items: events };
			}
		})
	})
}));

const { ClusterEventsService } = await import('~/modules/platform/cluster/cluster-events.service');

beforeEach(() => {
	events = [];
	listThrows = false;
	lastFieldSelector = undefined;
});

describe('ClusterEventsService', () => {
	test('requests only warning events', async () => {
		await new ClusterEventsService().getEvents();
		expect(lastFieldSelector).toBe('type=Warning');
	});

	test('sorts events newest first', async () => {
		events = [warning('old', '2026-07-30T10:00:00Z'), warning('new', '2026-07-30T12:00:00Z')];
		const result = await new ClusterEventsService().getEvents();
		expect(result.events.map(event => event.reason)).toEqual(['new', 'old']);
	});

	test('caps the list at fifty events', async () => {
		events = Array.from({ length: 80 }, (_, index) => warning(`r${index}`, '2026-07-30T10:00:00Z'));
		const result = await new ClusterEventsService().getEvents();
		expect(result.events).toHaveLength(50);
	});

	test('maps the involved object and namespace', async () => {
		events = [warning('BackOff', '2026-07-30T10:00:00Z')];
		const result = await new ClusterEventsService().getEvents();
		expect(result.events[0]).toEqual({
			id: 'uid-BackOff',
			reason: 'BackOff',
			message: 'BackOff happened',
			namespace: 'kubwave',
			objectKind: 'Pod',
			objectName: 'api-1',
			count: 1,
			lastSeen: '2026-07-30T10:00:00.000Z'
		});
	});

	test('defaults a missing count to one', async () => {
		events = [warning('NoCount', '2026-07-30T10:00:00Z', { count: undefined })];
		const result = await new ClusterEventsService().getEvents();
		expect(result.events[0]!.count).toBe(1);
	});

	test('falls back to namespace/name when the uid is missing', async () => {
		events = [warning('NoUid', '2026-07-30T10:00:00Z', { metadata: { name: 'event-NoUid', namespace: 'kubwave' } })];
		const result = await new ClusterEventsService().getEvents();
		expect(result.events[0]!.id).toBe('kubwave/event-NoUid');
	});

	test('falls back to the creation timestamp when lastTimestamp is absent', async () => {
		events = [
			warning('Created', '2026-07-30T10:00:00Z', {
				lastTimestamp: undefined,
				metadata: { uid: 'uid-Created', name: 'e', namespace: 'kubwave', creationTimestamp: '2026-07-29T08:00:00Z' }
			})
		];
		const result = await new ClusterEventsService().getEvents();
		expect(result.events[0]!.lastSeen).toBe('2026-07-29T08:00:00.000Z');
	});

	test('returns unavailable when the events read fails', async () => {
		listThrows = true;
		const result = await new ClusterEventsService().getEvents();
		expect(result.available).toBe(false);
		expect(result.events).toEqual([]);
	});
});
