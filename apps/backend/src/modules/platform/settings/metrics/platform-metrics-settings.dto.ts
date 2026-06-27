import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { MetricsProvider } from '../../../../shared/metrics/metrics-config.service.js';

export const metricsProviderSchema = z.enum(['live', 'prometheus-external', 'prometheus-managed']);

export const updateMetricsSettingsSchema = z
	.object({
		provider: metricsProviderSchema,
		prometheusUrl: z.string().url().nullable().optional()
	})
	.superRefine((value, ctx) => {
		if (value.provider === 'prometheus-external' && !value.prometheusUrl) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A Prometheus URL is required for the external provider.', path: ['prometheusUrl'] });
		}
	});

export type UpdateMetricsSettingsInput = z.infer<typeof updateMetricsSettingsSchema>;

export class MetricsSettingsDto {
	@ApiProperty({ enum: ['live', 'prometheus-external', 'prometheus-managed'] })
	provider!: MetricsProvider;

	@ApiProperty({ type: String, nullable: true })
	prometheusUrl!: string | null;
}

export class UpdateMetricsSettingsDto implements UpdateMetricsSettingsInput {
	@ApiProperty({ enum: ['live', 'prometheus-external', 'prometheus-managed'] })
	provider!: MetricsProvider;

	@ApiProperty({ type: String, nullable: true, required: false })
	prometheusUrl?: string | null;
}
