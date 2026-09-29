import type { ClusterComponent, ClusterEvent, ClusterNode, ClusterNodeCondition, ClusterNodeDetail, ClusterSnapshot } from '@/lib/api/types';
import type { MetricPoint } from '@/lib/metrics-chart';

export const MONITORING_TABS = ['utilization', 'nodes', 'components', 'events'] as const;
export type MonitoringTab = (typeof MONITORING_TABS)[number];

export function parseMonitoringTab(value: string | undefined): MonitoringTab {
	return MONITORING_TABS.find(tab => tab === value) ?? 'utilization';
}

// The tab lives in the query so a reload or the node page's way back lands on it; the default keeps the URL clean.
export function searchWithTab(search: string, tab: MonitoringTab): string {
	const params = new URLSearchParams(search);
	if (tab === 'utilization') params.delete('tab');
	else params.set('tab', tab);
	const query = params.toString();
	return query ? `?${query}` : '';
}

// Node names are DNS subdomains, so they are URL-safe as they are.
export const nodeHref = (name: string) => `/admin/monitoring/nodes/${name}`;

export type NodeBadge = 'Ready' | 'NotReady' | 'Cordoned' | 'MemoryPressure' | 'DiskPressure' | 'PIDPressure';

const PRESSURES = [
	['memoryPressure', 'MemoryPressure'],
	['diskPressure', 'DiskPressure'],
	['pidPressure', 'PIDPressure']
] as const;

export function nodeBadges(node: Pick<ClusterNode, 'cordoned' | 'conditions'>): NodeBadge[] {
	return [
		node.conditions.ready ? 'Ready' : 'NotReady',
		...(node.cordoned ? (['Cordoned'] as const) : []),
		...PRESSURES.filter(([key]) => node.conditions[key]).map(([, label]) => label)
	];
}

export type ComponentHealth = 'running' | 'degraded' | 'failed';

export function componentHealth(component: Pick<ClusterComponent, 'ready' | 'desired'>): ComponentHealth {
	if (component.ready >= component.desired) return 'running';
	return component.ready === 0 ? 'failed' : 'degraded';
}

// Array sort is stable, so the backend's name order holds within each group.
export function componentsByHealth<T extends ClusterComponent>(components: readonly T[]): T[] {
	const healthy = (component: T) => Number(componentHealth(component) === 'running');
	return [...components].sort((a, b) => healthy(a) - healthy(b));
}

const MAX_PROBLEMS = 3;
// Cordoning is deliberate and never degrades the cluster, so it is not a problem.
const NOT_PROBLEMS = new Set<NodeBadge>(['Ready', 'Cordoned']);

// Mirrors the backend's degraded rule, so the strip names what tipped it instead of sending the admin hunting through tabs.
export function problemSummary(snapshot: Pick<ClusterSnapshot, 'state' | 'nodes' | 'components'>): string {
	if (snapshot.state !== 'degraded') return '';
	const problems = [
		...snapshot.nodes.flatMap(node => nodeBadges(node).flatMap(badge => (NOT_PROBLEMS.has(badge) ? [] : [`${node.name} ${badge}`]))),
		...snapshot.components
			.filter(component => componentHealth(component) !== 'running')
			.map(component => `${component.name} ${component.ready}/${component.desired} ready`)
	];
	const more = problems.length - MAX_PROBLEMS;
	return problems.slice(0, MAX_PROBLEMS).join(', ') + (more > 0 ? ` +${more} more` : '');
}

// ~22 min of history at the 15s snapshot poll; without Prometheus there is no stored series, so the page buffers one in-session.
export const MAX_LIVE_SAMPLES = 90;

export type LiveSeries = { sampledAt: string | null; cpuMillicores: MetricPoint[]; memoryBytes: MetricPoint[] };

export const emptyLiveSeries: LiveSeries = { sampledAt: null, cpuMillicores: [], memoryBytes: [] };

// Returns the same object when there is nothing new, so a state update with it is a no-op.
export function appendLiveSample(series: LiveSeries, snapshot: ClusterSnapshot | undefined): LiveSeries {
	if (!snapshot?.available || snapshot.cpu.used == null || snapshot.memory.used == null) return series;
	if (series.sampledAt === snapshot.sampledAt) return series;
	const t = Math.floor(Date.parse(snapshot.sampledAt) / 1000);
	return {
		sampledAt: snapshot.sampledAt,
		cpuMillicores: [...series.cpuMillicores, { t, v: snapshot.cpu.used }].slice(-MAX_LIVE_SAMPLES),
		memoryBytes: [...series.memoryBytes, { t, v: snapshot.memory.used }].slice(-MAX_LIVE_SAMPLES)
	};
}

export function eventObject(event: ClusterEvent): string | null {
	if (!event.objectKind || !event.objectName) return null;
	return `${event.namespace ? `${event.namespace}/` : ''}${event.objectKind}/${event.objectName}`;
}

export function filterEvents(events: readonly ClusterEvent[], query: string): ClusterEvent[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...events];
	return events.filter(event => `${event.reason} ${event.message} ${eventObject(event) ?? ''}`.toLowerCase().includes(needle));
}

export { usageSeverity, type Severity } from '@/lib/usage';

// Ready is the one condition where True is good; every other node condition reports a problem when True.
export function isConditionHealthy(condition: ClusterNodeCondition): boolean {
	return condition.type === 'Ready' ? condition.status === 'True' : condition.status !== 'True';
}

export function nodeUnavailableMessage(detail: ClusterNodeDetail | undefined): string | null {
	if (!detail) return 'This page failed to load. It keeps retrying automatically.';
	if (detail.available) return null;
	return detail.unavailableReason === 'not-found'
		? 'This node is no longer part of the cluster.'
		: 'The cluster could not be reached. This page keeps retrying automatically, and the node may still be here.';
}

// Anything but a settled phase is a container stuck in a waiting or terminated reason (CrashLoopBackOff, ImagePullBackOff…).
export function isSettledPod(status: string): boolean {
	return status === 'Running' || status === 'Succeeded';
}
