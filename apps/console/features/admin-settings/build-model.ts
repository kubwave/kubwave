import type { BuildSettingsDto } from '@kubwave/api-client';
import type { GroupSpec } from './settings-group';

export type BuildDraft = Omit<BuildSettingsDto, 'maxConcurrentBuilds' | 'timeoutSeconds' | 'queueTimeoutSeconds'> & {
	maxConcurrentBuilds: string;
	timeoutSeconds: string;
	queueTimeoutSeconds: string;
};
const cpu = (value: string) => (value.endsWith('m') ? Number(value.slice(0, -1)) : Number(value) * 1000);
const MEMORY_QUANTITY = /^((?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)([KMGTPE]i|[kMGTPEm])?$/;
const MEMORY_FACTORS: Record<string, number> = {
	Ki: 1024,
	Mi: 1024 ** 2,
	Gi: 1024 ** 3,
	Ti: 1024 ** 4,
	Pi: 1024 ** 5,
	Ei: 1024 ** 6,
	k: 1e3,
	M: 1e6,
	G: 1e9,
	T: 1e12,
	P: 1e15,
	E: 1e18,
	m: 1e-3
};
const memory = (value: string) => {
	const match = MEMORY_QUANTITY.exec(value);
	return match ? Number(match[1]) * (MEMORY_FACTORS[match[2] ?? ''] ?? 1) : NaN;
};

export const buildGroup: GroupSpec<BuildSettingsDto, BuildDraft, BuildSettingsDto> = {
	initial: {
		execution: 'cluster',
		cpuRequest: '',
		cpuLimit: '',
		memoryRequest: '1.5Gi',
		memoryLimit: '2Gi',
		maxConcurrentBuilds: '3',
		timeoutSeconds: '1800',
		queueTimeoutSeconds: '86400',
		fallbackToCluster: false
	},
	toDraft: settings => ({
		...settings,
		maxConcurrentBuilds: String(settings.maxConcurrentBuilds),
		timeoutSeconds: String(settings.timeoutSeconds),
		queueTimeoutSeconds: String(settings.queueTimeoutSeconds)
	}),
	toPayload: draft => ({
		...draft,
		cpuRequest: draft.cpuRequest.trim(),
		cpuLimit: draft.cpuLimit.trim(),
		memoryRequest: draft.memoryRequest.trim(),
		memoryLimit: draft.memoryLimit.trim(),
		maxConcurrentBuilds: Number(draft.maxConcurrentBuilds),
		timeoutSeconds: Number(draft.timeoutSeconds),
		queueTimeoutSeconds: Number(draft.queueTimeoutSeconds)
	}),
	errors: draft => {
		const errors: Partial<Record<keyof BuildDraft, string>> = {};
		for (const key of ['cpuRequest', 'cpuLimit'] as const)
			if (draft[key] && (!/^\d+(?:\.\d+)?m?$/.test(draft[key].trim()) || cpu(draft[key]) <= 0))
				errors[key] = 'Use a positive CPU quantity, such as 500m or 2.';
		for (const key of ['memoryRequest', 'memoryLimit'] as const)
			if (!(memory(draft[key].trim()) > 0)) errors[key] = 'Use a positive memory quantity, such as 512Mi, 4Gi or 2G.';
		if (draft.cpuRequest && draft.cpuLimit && cpu(draft.cpuLimit) < cpu(draft.cpuRequest)) errors.cpuLimit = 'Limit must be at least the request.';
		if (memory(draft.memoryLimit) < memory(draft.memoryRequest)) errors.memoryLimit = 'Limit must be at least the request.';
		for (const [key, min, max] of [
			['maxConcurrentBuilds', 1, 100],
			['timeoutSeconds', 60, 86400],
			['queueTimeoutSeconds', 60, 604800]
		] as const) {
			const value = Number(draft[key]);
			if (!Number.isInteger(value) || value < min || value > max) errors[key] = `Enter a whole number from ${min} to ${max}.`;
		}
		return errors;
	}
};
