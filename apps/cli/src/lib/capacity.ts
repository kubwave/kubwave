import type { KubeConfig } from '@kubernetes/client-node';
import { CoreV1Api } from '@kubernetes/client-node';
import { parseAllDocuments } from 'yaml';

export interface Capacity {
	cpuMillis: number;
	memBytes: number;
}

export function addCapacity(a: Capacity, b: Capacity): Capacity {
	return { cpuMillis: a.cpuMillis + b.cpuMillis, memBytes: a.memBytes + b.memBytes };
}

export function parseCpuToMillis(value: unknown): number {
	if (value === undefined || value === null) return 0;
	const s = String(value).trim();
	if (s === '') return 0;
	if (s.endsWith('m')) return Math.round(parseFloat(s.slice(0, -1)) || 0);
	if (s.endsWith('n')) return Math.round((parseFloat(s.slice(0, -1)) || 0) / 1e6);
	if (s.endsWith('u')) return Math.round((parseFloat(s.slice(0, -1)) || 0) / 1e3);
	return Math.round((parseFloat(s) || 0) * 1000);
}

const MEM_UNITS: Record<string, number> = {
	Ki: 2 ** 10,
	Mi: 2 ** 20,
	Gi: 2 ** 30,
	Ti: 2 ** 40,
	Pi: 2 ** 50,
	Ei: 2 ** 60,
	k: 1e3,
	M: 1e6,
	G: 1e9,
	T: 1e12,
	P: 1e15,
	E: 1e18
};

export function parseMemToBytes(value: unknown): number {
	if (value === undefined || value === null) return 0;
	const m = String(value)
		.trim()
		.match(/^([0-9.]+)([A-Za-z]+)?$/);
	if (!m) return 0;
	const n = parseFloat(m[1] ?? '') || 0;
	return m[2] ? Math.round(n * (MEM_UNITS[m[2]] ?? 1)) : Math.round(n);
}

export function formatCpu(millis: number): string {
	return millis >= 1000 && millis % 1000 === 0 ? `${millis / 1000}` : `${millis}m`;
}

export function formatMem(bytes: number): string {
	const gi = bytes / 2 ** 30;
	return gi >= 1 ? `${Math.round(gi * 10) / 10}Gi` : `${Math.round(bytes / 2 ** 20)}Mi`;
}

function selectorMatches(labels: Record<string, string>, selector: Record<string, string>): boolean {
	return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function podSpecRequests(podSpec: any): Capacity {
	const containers = Array.isArray(podSpec?.containers) ? podSpec.containers : [];
	let cpuMillis = 0;
	let memBytes = 0;
	for (const c of containers) {
		const req = c?.resources?.requests;
		if (!req) continue;
		cpuMillis += parseCpuToMillis(req.cpu);
		memBytes += parseMemToBytes(req.memory);
	}
	return { cpuMillis, memBytes };
}

// Sum resource requests from `helm template` output. Deployments/StatefulSets scale by replicas and the CNPG
// Cluster CR by spec.instances; DaemonSets/CronJobs are ignored (per-node or scheduled overhead the primer
// can't usefully pre-size).
export function sumRequestsFromManifests(renderedYaml: string): Capacity {
	let total: Capacity = { cpuMillis: 0, memBytes: 0 };
	for (const doc of parseAllDocuments(renderedYaml)) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const obj: any = doc.toJS({ maxAliasCount: -1 });
		if (!obj || typeof obj !== 'object' || typeof obj.kind !== 'string') continue;
		if (obj.kind === 'Deployment' || obj.kind === 'StatefulSet' || obj.kind === 'ReplicaSet') {
			const replicas = typeof obj.spec?.replicas === 'number' ? obj.spec.replicas : 1;
			const per = podSpecRequests(obj.spec?.template?.spec);
			total = addCapacity(total, { cpuMillis: per.cpuMillis * replicas, memBytes: per.memBytes * replicas });
		} else if (obj.kind === 'Pod' || obj.kind === 'Job') {
			total = addCapacity(total, podSpecRequests(obj.spec?.template?.spec ?? obj.spec));
		} else if (obj.kind === 'Cluster' && String(obj.apiVersion ?? '').startsWith('postgresql.cnpg.io')) {
			const instances = typeof obj.spec?.instances === 'number' ? obj.spec.instances : 1;
			const req = obj.spec?.resources?.requests;
			total = addCapacity(total, { cpuMillis: parseCpuToMillis(req?.cpu) * instances, memBytes: parseMemToBytes(req?.memory) * instances });
		}
	}
	return total;
}

export interface SchedulableCapacity {
	capacity: Capacity;
	readyNodes: number;
	matchingNodes: number;
}

// Allocatable capacity of the Ready, schedulable nodes matching the platform node selector.
export async function getSchedulableCapacity(kc: KubeConfig, nodeSelector: Record<string, string>): Promise<SchedulableCapacity> {
	const api = kc.makeApiClient(CoreV1Api);
	const nodes = await api.listNode();
	let cpuMillis = 0;
	let memBytes = 0;
	let readyNodes = 0;
	let matchingNodes = 0;
	for (const node of nodes.items) {
		if (!selectorMatches(node.metadata?.labels ?? {}, nodeSelector)) continue;
		matchingNodes++;
		const ready = node.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True');
		if (!ready || node.spec?.unschedulable) continue;
		readyNodes++;
		const alloc = node.status?.allocatable ?? {};
		cpuMillis += parseCpuToMillis(alloc.cpu);
		memBytes += parseMemToBytes(alloc.memory);
	}
	return { capacity: { cpuMillis, memBytes }, readyNodes, matchingNodes };
}
