import { z } from 'zod';

export const metricsRangeSchema = z.enum(['1h', '24h', '7d']);

export type MetricsRange = z.infer<typeof metricsRangeSchema>;

export const metricsQuerySchema = z.object({ range: metricsRangeSchema.optional() });

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

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
