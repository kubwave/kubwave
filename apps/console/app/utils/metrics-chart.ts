// Pure, import-free helpers for the service-metrics chart so they're unit-testable (the console has no DOM test harness).

export type MetricsRange = '1h' | '24h' | '7d';

export interface MetricPoint {
	t: number;
	v: number;
}

export interface ChartMarker {
	x: number;
	at: number; // epoch seconds
	id: string;
	status: string;
}

// Minimal shape to place a deploy marker; Deployment satisfies it structurally, decoupling the helper from the heavy inferred RPC types.
export interface DeployEventInput {
	id: string;
	createdAt: string;
	status: string;
}

// Range-aware poll interval (ms), or false for no polling; 7d barely moves so it refreshes only on a manual range change.
const POLL_MS: Record<MetricsRange, number | false> = {
	'1h': 30_000,
	'24h': 300_000,
	'7d': false
};

export function pollIntervalForRange(range: MetricsRange): number | false {
	return POLL_MS[range];
}

// Fractional x (0..1) of a timestamp within [start, end], clamped; a zero/negative-width domain pins to 0 to avoid divide-by-zero.
export function fractionalX(t: number, start: number, end: number): number {
	if (end <= start) return 0;
	return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

export function seriesDomain(points: MetricPoint[]): { start: number; end: number } | null {
	if (points.length === 0) return null;
	return { start: points[0]!.t, end: points[points.length - 1]!.t };
}

// Deploy markers for deploys whose createdAt falls inside the chart domain; input order is preserved (callers pass newest-first).
export function deployMarkers(deployments: DeployEventInput[], domain: { start: number; end: number } | null): ChartMarker[] {
	if (!domain) return [];
	const markers: ChartMarker[] = [];
	for (const deployment of deployments) {
		const at = Math.floor(Date.parse(deployment.createdAt) / 1000);
		if (!Number.isFinite(at) || at < domain.start || at > domain.end) continue;
		markers.push({ x: fractionalX(at, domain.start, domain.end), at, id: deployment.id, status: deployment.status });
	}
	return markers;
}

// Per-second rate series from cumulative-counter samples; a counter reset (pod restart → negative delta) clamps to 0, not a huge negative spike.
export function deriveRateSeries(samples: MetricPoint[]): MetricPoint[] {
	const out: MetricPoint[] = [];
	for (let i = 1; i < samples.length; i++) {
		const prev = samples[i - 1]!;
		const cur = samples[i]!;
		const dt = cur.t - prev.t;
		if (dt <= 0) continue;
		const delta = cur.v - prev.v;
		out.push({ t: cur.t, v: delta > 0 ? delta / dt : 0 });
	}
	return out;
}

// Index of the point closest to a fractional x (0..1); used for hover read-out. Returns -1 when empty.
export function nearestIndex(points: MetricPoint[], fraction: number): number {
	const domain = seriesDomain(points);
	if (!domain) return -1;
	const clamped = Math.min(1, Math.max(0, fraction));
	const targetT = domain.start + clamped * (domain.end - domain.start);
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < points.length; i++) {
		const dist = Math.abs(points[i]!.t - targetT);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}
