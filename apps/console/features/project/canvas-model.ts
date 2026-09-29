import type { FlowNodePosition } from '@/lib/api/types';
import { percentOf } from '@/lib/format';
import { snapFlowPosition } from '@/lib/flow-layout';
import { parseQuantityToBytes } from '@/lib/service-settings';
import { isDatabaseEngine } from '@/lib/service-types';

type Link = { sourceServiceId: string; targetServiceId: string };
type LayoutService = { id: string; type: string };

type VolumeStats = { usedBytes: number; capacityBytes: number };

const GIB = 1024 ** 3;

// Usage to show for a volume of the given requested size. Volumes that don't enforce their size
// (local-path storage, e.g. k3d/k3s) report the node's whole disk, e.g. "900 GiB / 1.3 TiB" for a
// 1Gi claim; that is flagged as nodeDisk so it isn't mistaken for the volume filling up. Providers
// that round small claims up (Hetzner: at least 10 GiB) stay under the 16 GiB floor.
export function volumeUsage(size: string, stats: VolumeStats | null): (VolumeStats & { pct: number; nodeDisk: boolean }) | null {
	if (!stats) return null;
	const requested = parseQuantityToBytes(size) ?? 0;
	return {
		...stats,
		pct: percentOf(stats.usedBytes, stats.capacityBytes) ?? 0,
		nodeDisk: stats.capacityBytes > Math.max(requested * 2, 16 * GIB)
	};
}

const COLUMN_WIDTH = 352;
const ROW_HEIGHT = 220;

// Column = how deep a service sits in the "references" chain: callers left, dependencies right.
// Databases go right of every app that calls something, so they stack beside other dependencies
// (a cache, an API) instead of behind them. Cycles are cut at the first revisit.
export function tidyLayout(services: readonly LayoutService[], links: readonly Link[]): Record<string, FlowNodePosition> {
	const depthById = new Map<string, number>();
	const depthOf = (id: string, visiting: Set<string>): number => {
		const known = depthById.get(id);
		if (known !== undefined) return known;
		if (visiting.has(id)) return 0;
		visiting.add(id);
		const callers = links.filter(link => link.targetServiceId === id && link.sourceServiceId !== id);
		const depth = callers.length ? Math.max(...callers.map(link => depthOf(link.sourceServiceId, visiting) + 1)) : 0;
		depthById.set(id, depth);
		return depth;
	};
	for (const service of services) depthOf(service.id, new Set());

	const callers = services.filter(service => !isDatabaseEngine(service.type) && links.some(link => link.sourceServiceId === service.id));
	const hasApps = services.some(service => !isDatabaseEngine(service.type));
	const databaseColumn = Math.max(hasApps ? 1 : 0, ...callers.map(service => (depthById.get(service.id) ?? 0) + 1));
	const columnById = new Map(
		services.map(service => {
			const depth = depthById.get(service.id) ?? 0;
			return [service.id, isDatabaseEngine(service.type) ? Math.max(databaseColumn, depth) : depth];
		})
	);
	// An entry point (nothing calls it) moves up to its nearest dependency, so its edge does not
	// run through the columns in between.
	for (const service of services) {
		if (isDatabaseEngine(service.type) || links.some(link => link.targetServiceId === service.id)) continue;
		const calleeColumns = links.filter(link => link.sourceServiceId === service.id).map(link => columnById.get(link.targetServiceId) ?? 0);
		if (calleeColumns.length) columnById.set(service.id, Math.max(0, Math.min(...calleeColumns) - 1));
	}
	// Rows follow the average row of each service's callers (placed column by column), which keeps
	// most edges straight and uncrossed. Services without placed callers keep their order below.
	const rowById = new Map<string, number>();
	const callerRow = (id: string) => {
		const rows = links.flatMap(link =>
			link.targetServiceId === id && rowById.has(link.sourceServiceId) ? [rowById.get(link.sourceServiceId)!] : []
		);
		return rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : Number.MAX_SAFE_INTEGER;
	};
	for (const column of [...new Set(columnById.values())].sort((a, b) => a - b)) {
		const members = services.filter(service => columnById.get(service.id) === column);
		const keys = new Map(members.map(service => [service.id, callerRow(service.id)]));
		members.sort((a, b) => keys.get(a.id)! - keys.get(b.id)!).forEach((service, row) => rowById.set(service.id, row));
	}
	return Object.fromEntries(
		services.map(service => [
			service.id,
			snapFlowPosition({ x: (columnById.get(service.id) ?? 0) * COLUMN_WIDTH, y: (rowById.get(service.id) ?? 0) * ROW_HEIGHT })
		])
	);
}
