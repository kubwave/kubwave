import type { ServiceLogEntry, ServiceMetrics } from '@/lib/api/types';
import { deriveRateSeries, type MetricPoint } from '@/lib/metrics-chart';

// Each log poll re-tails the last N lines and overlaps the previous one; pod + timestamp + message
// identifies a line well enough to drop the repeats.
export const logKey = (entry: ServiceLogEntry) => `${entry.pod} ${entry.timestamp ?? ''} ${entry.message}`;

export function appendLogEntries(buffer: ServiceLogEntry[], incoming: ServiceLogEntry[], max: number): ServiceLogEntry[] {
	const seen = new Set(buffer.map(logKey));
	const fresh = incoming.filter(entry => !seen.has(logKey(entry)));
	return fresh.length === 0 ? buffer : [...buffer, ...fresh].slice(-max);
}

// Live (kubelet) metrics are a single point per poll; the chart history is buffered in the browser.
export type LiveSample = { t: number; cpu: number; mem: number; rx: number; tx: number };

export function appendLiveSample(samples: LiveSample[], metrics: Pick<ServiceMetrics, 'sampledAt' | 'current'>, max: number): LiveSample[] {
	const t = Math.floor(new Date(metrics.sampledAt).getTime() / 1000);
	if (samples.at(-1)?.t === t) return samples;
	const { cpuMillicores: cpu, memoryBytes: mem, networkRxBytes: rx, networkTxBytes: tx } = metrics.current;
	return [...samples, { t, cpu, mem, rx, tx }].slice(-max);
}

export type LiveSeries = Record<'cpuMillicores' | 'memoryBytes' | 'networkRxBytes' | 'networkTxBytes', MetricPoint[]>;

// Network counters are cumulative, so their series become per-second rates.
export function liveSeries(samples: LiveSample[]): LiveSeries {
	return {
		cpuMillicores: samples.map(sample => ({ t: sample.t, v: sample.cpu })),
		memoryBytes: samples.map(sample => ({ t: sample.t, v: sample.mem })),
		networkRxBytes: deriveRateSeries(samples.map(sample => ({ t: sample.t, v: sample.rx }))),
		networkTxBytes: deriveRateSeries(samples.map(sample => ({ t: sample.t, v: sample.tx })))
	};
}
