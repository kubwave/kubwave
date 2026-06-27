import type { MetricsRange } from './metrics.dto.js';

export type { MetricsRange };

export interface RangeSpec {
	windowSeconds: number;
	stepSeconds: number;
	rateWindow: string;
}

export interface PromMatrixResult {
	metric: Record<string, string>;
	values: [number, string][];
}

export interface PrometheusMetricPoint {
	t: number;
	v: number;
}
