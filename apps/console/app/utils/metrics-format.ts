import { formatBytes } from '~/utils/format';
import type { MetricsRange } from '~/utils/metrics-chart';

export function formatCpu(millicores: number): string {
	if (millicores >= 1000) return `${(millicores / 1000).toFixed(2)} cores`;
	return `${Math.round(millicores)}m`;
}

export function formatRate(bytesPerSec: number | null | undefined): string {
	if (bytesPerSec == null) return '—';
	return `${formatBytes(bytesPerSec)}/s`;
}

export function makeMetricsTimeFormatter(range: MetricsRange): (epochSec: number) => string {
	return epochSec => {
		const date = new Date(epochSec * 1000);
		if (range === '7d') return date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
		return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	};
}
