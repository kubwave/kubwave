import { describe, expect, test } from 'bun:test';
import {
	appendLiveSample,
	componentHealth,
	componentsByHealth,
	emptyLiveSeries,
	filterEvents,
	isConditionHealthy,
	MAX_LIVE_SAMPLES,
	nodeBadges,
	nodeUnavailableMessage,
	parseMonitoringTab,
	problemSummary,
	searchWithTab,
	usageSeverity
} from '../features/admin-monitoring/model';
import type { ClusterEvent, ClusterNode, ClusterNodeDetail, ClusterSnapshot } from '../lib/api/types';

const meter = { capacity: 0, requested: null, used: null };
const conditions = { ready: true, memoryPressure: false, diskPressure: false, pidPressure: false };

function node(name: string, overrides: Partial<ClusterNode> = {}): ClusterNode {
	return { name, roles: [], cordoned: false, kubeletVersion: '', conditions, cpu: meter, memory: meter, disk: meter, pods: meter, ...overrides };
}

function snapshot(overrides: Partial<ClusterSnapshot> = {}): ClusterSnapshot {
	const zero = { cpuMillicores: 0, memoryBytes: 0 };
	return {
		available: true,
		sampledAt: '2026-09-28T10:00:00Z',
		state: 'ok',
		nodesReady: 0,
		nodesTotal: 0,
		cpu: { capacity: 4000, requested: 1000, used: 500 },
		memory: { capacity: 8e9, requested: 2e9, used: 1e9 },
		storage: meter,
		pods: meter,
		nodes: [],
		components: [],
		split: { platform: zero, tenants: zero, other: zero },
		...overrides
	};
}

function event(id: string, overrides: Partial<ClusterEvent> = {}): ClusterEvent {
	return { id, reason: 'BackOff', message: '', namespace: null, objectKind: null, objectName: null, count: 1, lastSeen: null, ...overrides };
}

describe('parseMonitoringTab', () => {
	test('reads a known tab and falls back to utilization', () => {
		expect(parseMonitoringTab('events')).toBe('events');
		expect(parseMonitoringTab('bogus')).toBe('utilization');
		expect(parseMonitoringTab(undefined)).toBe('utilization');
	});
});

describe('searchWithTab', () => {
	test('drops the tab param for utilization, keeping the URL clean', () => {
		expect(searchWithTab('?tab=nodes', 'utilization')).toBe('');
	});

	test('sets the tab and keeps unrelated params', () => {
		expect(searchWithTab('?foo=1', 'events')).toBe('?foo=1&tab=events');
		expect(searchWithTab('', 'nodes')).toBe('?tab=nodes');
	});
});

describe('nodeBadges', () => {
	test('a healthy schedulable node is just Ready', () => {
		expect(nodeBadges(node('a'))).toEqual(['Ready']);
	});

	test('lists NotReady, Cordoned and every pressure', () => {
		const sick = node('b', { cordoned: true, conditions: { ready: false, memoryPressure: true, diskPressure: true, pidPressure: true } });
		expect(nodeBadges(sick)).toEqual(['NotReady', 'Cordoned', 'MemoryPressure', 'DiskPressure', 'PIDPressure']);
	});
});

describe('problemSummary', () => {
	test('is empty while the cluster is healthy', () => {
		expect(problemSummary(snapshot({ nodes: [node('a', { conditions: { ...conditions, ready: false } })] }))).toBe('');
	});

	test('names unhealthy nodes and components but not cordoning', () => {
		const degraded = snapshot({
			state: 'degraded',
			nodes: [node('a', { cordoned: true, conditions: { ...conditions, diskPressure: true } })],
			components: [
				{ name: 'api', ready: 1, desired: 1 },
				{ name: 'worker', ready: 0, desired: 2 }
			]
		});
		expect(problemSummary(degraded)).toBe('a DiskPressure, worker 0/2 ready');
	});

	test('shows three problems and counts the rest', () => {
		const degraded = snapshot({
			state: 'degraded',
			nodes: ['a', 'b', 'c', 'd', 'e'].map(name => node(name, { conditions: { ...conditions, ready: false } }))
		});
		expect(problemSummary(degraded)).toBe('a NotReady, b NotReady, c NotReady +2 more');
	});
});

describe('componentHealth', () => {
	test('all replicas ready is running, none is failed, some is degraded', () => {
		expect(componentHealth({ ready: 2, desired: 2 })).toBe('running');
		expect(componentHealth({ ready: 0, desired: 0 })).toBe('running');
		expect(componentHealth({ ready: 0, desired: 2 })).toBe('failed');
		expect(componentHealth({ ready: 1, desired: 2 })).toBe('degraded');
	});
});

describe('componentsByHealth', () => {
	test('puts unhealthy components first and keeps name order within each group', () => {
		const sorted = componentsByHealth([
			{ name: 'api', ready: 1, desired: 1 },
			{ name: 'console', ready: 0, desired: 1 },
			{ name: 'postgres', ready: 1, desired: 1 },
			{ name: 'worker', ready: 1, desired: 2 }
		]);
		expect(sorted.map(component => component.name)).toEqual(['console', 'worker', 'api', 'postgres']);
	});
});

describe('appendLiveSample', () => {
	test('appends cpu and memory at the sample time', () => {
		const series = appendLiveSample(emptyLiveSeries, snapshot());
		expect(series.cpuMillicores).toEqual([{ t: 1_790_589_600, v: 500 }]);
		expect(series.memoryBytes).toEqual([{ t: 1_790_589_600, v: 1e9 }]);
	});

	test('ignores a repeated sample, keeping the same object', () => {
		const once = appendLiveSample(emptyLiveSeries, snapshot());
		expect(appendLiveSample(once, snapshot())).toBe(once);
	});

	test('skips unavailable or unmeasured snapshots', () => {
		expect(appendLiveSample(emptyLiveSeries, undefined)).toBe(emptyLiveSeries);
		expect(appendLiveSample(emptyLiveSeries, snapshot({ available: false }))).toBe(emptyLiveSeries);
		expect(appendLiveSample(emptyLiveSeries, snapshot({ cpu: meter }))).toBe(emptyLiveSeries);
	});

	test('keeps only the newest samples', () => {
		let series = emptyLiveSeries;
		for (let i = 0; i < MAX_LIVE_SAMPLES + 5; i++) series = appendLiveSample(series, snapshot({ sampledAt: new Date(i * 15_000).toISOString() }));
		expect(series.cpuMillicores).toHaveLength(MAX_LIVE_SAMPLES);
		expect(series.cpuMillicores[0]!.t).toBe(5 * 15);
	});
});

describe('filterEvents', () => {
	const events = [
		event('1', { reason: 'BackOff', message: 'Back-off restarting container', namespace: 'kubwave', objectKind: 'Pod', objectName: 'api-1' }),
		event('2', { reason: 'FailedMount', message: 'Unable to attach volume', objectKind: 'Node', objectName: 'node-a' })
	];

	test('matches reason, message and object case-insensitively', () => {
		expect(filterEvents(events, 'backoff').map(e => e.id)).toEqual(['1']);
		expect(filterEvents(events, 'VOLUME').map(e => e.id)).toEqual(['2']);
		expect(filterEvents(events, 'node-a').map(e => e.id)).toEqual(['2']);
		expect(filterEvents(events, 'kubwave/pod').map(e => e.id)).toEqual(['1']);
	});

	test('an empty query keeps everything', () => {
		expect(filterEvents(events, '  ')).toHaveLength(2);
	});
});

describe('usageSeverity', () => {
	test('flags high usage from 75% and critical from 90%', () => {
		expect(usageSeverity(null)).toBe('unknown');
		expect(usageSeverity(74)).toBe('normal');
		expect(usageSeverity(75)).toBe('high');
		expect(usageSeverity(90)).toBe('critical');
	});
});

describe('isConditionHealthy', () => {
	test('Ready is healthy when True, every other condition when not True', () => {
		const condition = (type: string, status: string) => ({ type, status, reason: null, lastTransitionTime: null });
		expect(isConditionHealthy(condition('Ready', 'True'))).toBe(true);
		expect(isConditionHealthy(condition('Ready', 'Unknown'))).toBe(false);
		expect(isConditionHealthy(condition('MemoryPressure', 'False'))).toBe(true);
		expect(isConditionHealthy(condition('MemoryPressure', 'True'))).toBe(false);
	});
});

describe('nodeUnavailableMessage', () => {
	const detail = (overrides: Partial<ClusterNodeDetail>) => ({ available: true, unavailableReason: null, ...overrides }) as ClusterNodeDetail;

	test('is null for an available node', () => {
		expect(nodeUnavailableMessage(detail({}))).toBeNull();
	});

	test('tells a removed node apart from an unreachable cluster', () => {
		expect(nodeUnavailableMessage(detail({ available: false, unavailableReason: 'not-found' }))).toBe('This node is no longer part of the cluster.');
		expect(nodeUnavailableMessage(detail({ available: false, unavailableReason: 'unreachable' }))).toContain('could not be reached');
	});

	test('a failed request keeps retrying', () => {
		expect(nodeUnavailableMessage(undefined)).toContain('keeps retrying');
	});
});
