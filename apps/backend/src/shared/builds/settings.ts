import { z } from 'zod';

export const BUILD_SETTINGS_KEY = 'build_settings';

export function cpuMillicores(value: string): number {
	return value.endsWith('m') ? Number(value.slice(0, -1)) : Number(value) * 1000;
}

export function memoryBytes(value: string): number {
	const match = /^(\d+(?:\.\d+)?)(Mi|Gi|Ti)$/.exec(value);
	if (!match) return NaN;
	return Number(match[1]) * 1024 ** { Mi: 2, Gi: 3, Ti: 4 }[match[2] as 'Mi' | 'Gi' | 'Ti'];
}

const cpu = z
	.string()
	.trim()
	.refine(
		value => value === '' || (/^\d+(?:\.\d+)?m?$/.test(value) && cpuMillicores(value) > 0 && Number.isFinite(cpuMillicores(value))),
		'Use a positive CPU quantity, such as 500m or 2.'
	);
const memory = z
	.string()
	.trim()
	.refine(value => memoryBytes(value) > 0 && Number.isFinite(memoryBytes(value)), 'Use a positive memory quantity, such as 512Mi or 4Gi.');

export const buildSettingsSchema = z
	.object({
		execution: z.enum(['cluster', 'agent']),
		cpuRequest: cpu,
		cpuLimit: cpu,
		memoryRequest: memory,
		memoryLimit: memory,
		maxConcurrentBuilds: z.number().int().min(1).max(100),
		timeoutSeconds: z.number().int().min(60).max(86400),
		queueTimeoutSeconds: z.number().int().min(60).max(604800),
		fallbackToCluster: z.boolean()
	})
	.superRefine((value, ctx) => {
		if (value.cpuLimit && value.cpuRequest && cpuMillicores(value.cpuLimit) < cpuMillicores(value.cpuRequest))
			ctx.addIssue({ code: 'custom', path: ['cpuLimit'], message: 'CPU limit must be at least the request.' });
		if (memoryBytes(value.memoryLimit) < memoryBytes(value.memoryRequest))
			ctx.addIssue({ code: 'custom', path: ['memoryLimit'], message: 'Memory limit must be at least the request.' });
	});

export type BuildSettings = z.infer<typeof buildSettingsSchema>;

export function resolveBuildSettings(
	raw: unknown,
	defaults?: { memoryRequest?: string; memoryLimit?: string; timeoutSeconds?: number }
): BuildSettings {
	return buildSettingsSchema.parse(
		raw ?? {
			execution: 'cluster',
			cpuRequest: '',
			cpuLimit: '',
			memoryRequest: defaults?.memoryRequest ?? '1.5Gi',
			memoryLimit: defaults?.memoryLimit ?? '2Gi',
			maxConcurrentBuilds: 3,
			timeoutSeconds: defaults?.timeoutSeconds ?? 1800,
			queueTimeoutSeconds: 86400,
			fallbackToCluster: false
		}
	);
}
