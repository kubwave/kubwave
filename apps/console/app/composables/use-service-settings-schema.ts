import * as z from 'zod';
import type { Service } from '~/utils/types';
import { isDatabaseEngine } from '~/utils/database-engines';
import { isPrivateRepoSshUrl, privateRepoSshUrlMessage } from '~/utils/private-repo-url';

// Shape of a docker-image service's config file as returned/accepted by the API (content is decrypted on read).
type ConfigFile = { path: string; content: string };

export function isValidPort(value: string): boolean {
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// Kubernetes CPU quantity (cores 1/0.5/2 or millicpu 250m) and memory quantity (256Mi, 1Gi).
export const cpuRegex = /^(\d+(\.\d+)?|\d+m)$/;
export const memoryRegex = /^\d+(\.\d+)?[EPTGMK]i?$/;

// Storage quantity → bytes for comparing volume sizes; console has no @kubwave/kube dep, so the suffix factors live here.
export const QUANTITY_FACTORS: Record<string, number> = {
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
	E: 1e18
};

export function parseQuantityToBytes(quantity: string): number | null {
	const q = quantity.trim();
	for (const [suffix, factor] of Object.entries(QUANTITY_FACTORS)) {
		if (q.endsWith(suffix)) {
			const n = Number(q.slice(0, -suffix.length));
			return Number.isFinite(n) ? n * factor : null;
		}
	}
	const n = Number(q);
	return Number.isFinite(n) ? n : null;
}

export const healthCheckFormSchema = z.object({
	enabled: z.boolean(),
	type: z.enum(['http', 'tcp']),
	path: z.string(),
	port: z.string(),
	initialDelaySeconds: z.string(),
	periodSeconds: z.string(),
	timeoutSeconds: z.string(),
	failureThreshold: z.string(),
	successThreshold: z.string()
});

export const serviceSettingsSchema = z
	.object({
		name: z.string().trim().min(1, 'Enter a name.'),
		description: z.string(),
		// All type-specific fields coexist so one form can hold any shape; required-per-type is enforced in makeServiceSettingsSchema.
		image: z.string(),
		tag: z.string(),
		dockerfile: z.string(),
		repoUrl: z.string(),
		branch: z.string(),
		commit: z.string(),
		rootDirectory: z.string(),
		buildCommand: z.string(),
		startCommand: z.string(),
		// private-repo only: the team deploy key id. Empty for every other type.
		sshKeyId: z.string(),
		// public/private-repo only: build method + (dockerfile mode) the Dockerfile path. Empty otherwise.
		builder: z.string(),
		dockerfilePath: z.string(),
		// Managed-database only: engine version and backing storage size. Empty for every other type.
		version: z.string(),
		storage: z.string(),
		containerPort: z.string().refine(v => v.trim() === '' || isValidPort(v.trim()), 'Use a port between 1 and 65535.'),
		defaultDomainEnabled: z.boolean(),
		// `_id` is a stable, ui-only row key (stops Vue reusing DOM nodes by index on splice); stripped before submit.
		env: z.array(z.object({ _id: z.string(), key: z.string(), value: z.string() })),
		// `value`: new plaintext typed; `hasValue`: secret exists on server (value never sent back). Blank on hasValue → keep unchanged.
		secrets: z.array(z.object({ _id: z.string(), key: z.string(), value: z.string(), hasValue: z.boolean() })),
		domains: z.array(z.object({ _id: z.string(), host: z.string(), port: z.string() })),
		// `subPath` (optional) mounts a subdirectory of the volume; backend validates it, so it's loose here like name/mountPath.
		volumes: z.array(z.object({ _id: z.string(), name: z.string(), mountPath: z.string(), size: z.string(), subPath: z.string().optional() })),
		// docker-image only: files rendered + mounted into the container; `content` may be large/multiline (and may hold secrets).
		configFiles: z.array(z.object({ _id: z.string(), path: z.string(), content: z.string() })),
		// docker-image only: container entrypoint/args override (k8s command/args); one token per row, `_id` ui-only.
		command: z.array(z.object({ _id: z.string(), value: z.string() })),
		args: z.array(z.object({ _id: z.string(), value: z.string() })),
		healthCheck: healthCheckFormSchema,
		resources: z.object({
			cpuRequest: z.string(),
			cpuLimit: z.string(),
			memoryRequest: z.string(),
			memoryLimit: z.string()
		}),
		autoscaling: z.object({
			enabled: z.boolean(),
			minReplicas: z.string(),
			maxReplicas: z.string(),
			targetCpuUtilizationPercentage: z.string(),
			targetMemoryUtilizationPercentage: z.string()
		}),
		// Repo types only (ignored otherwise); just the toggle — the poll cadence is a global worker setting.
		autoDeploy: z.object({
			enabled: z.boolean()
		})
	})
	.superRefine((val, ctx) => {
		val.domains.forEach((d, i) => {
			if (d.host.trim() && !isValidPort(d.port.trim())) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use a port between 1 and 65535.', path: ['domains', i, 'port'] });
			}
		});
		if (val.healthCheck.enabled && val.healthCheck.type === 'http' && !val.healthCheck.path.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Path is required for HTTP health checks.', path: ['healthCheck', 'path'] });
		}
		const seenConfigPaths = new Set<string>();
		val.configFiles.forEach((cf, i) => {
			// Empty rows are dropped on submit; only validate a row once a path has been entered.
			const path = cf.path.trim();
			if (!path) return;
			if (!path.startsWith('/')) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use an absolute path like /etc/kong.yml.', path: ['configFiles', i, 'path'] });
			} else if (path.split('/').includes('..')) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Path cannot contain "..".', path: ['configFiles', i, 'path'] });
			} else if (seenConfigPaths.has(path)) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Each config file must have a unique path.', path: ['configFiles', i, 'path'] });
			}
			seenConfigPaths.add(path);
		});
		// Headroom under the 1 MiB Kubernetes Secret limit the rendered files Secret must fit within.
		const configFilesBytes = val.configFiles.reduce((sum, cf) => sum + new TextEncoder().encode(cf.content).length, 0);
		if (configFilesBytes > 900 * 1024) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Config files exceed the total size limit (about 900 KB).', path: ['configFiles'] });
		}
		(['cpuRequest', 'cpuLimit'] as const).forEach(k => {
			if (val.resources[k].trim() && !cpuRegex.test(val.resources[k].trim())) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use a CPU quantity like 250m or 1.', path: ['resources', k] });
			}
		});
		(['memoryRequest', 'memoryLimit'] as const).forEach(k => {
			if (val.resources[k].trim() && !memoryRegex.test(val.resources[k].trim())) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use a memory quantity like 256Mi or 1Gi.', path: ['resources', k] });
			}
		});

		const as = val.autoscaling;
		// Volumes + autoscaling are mutually exclusive (RWO PVC pins to one instance). Guard for saved services too.
		if (as.enabled && val.volumes.length > 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Disable autoscaling to use a volume — a volume pins the service to one instance.',
				path: ['autoscaling', 'enabled']
			});
		}
		if (as.enabled) {
			const min = as.minReplicas.trim();
			const max = as.maxReplicas.trim();
			const cpu = as.targetCpuUtilizationPercentage.trim();
			const mem = as.targetMemoryUtilizationPercentage.trim();
			const isPositiveInt = (v: string) => /^\d+$/.test(v) && Number(v) >= 1;
			// Mirror the API's 1..100 ceiling so out-of-range values are rejected inline instead of via a PATCH 400.
			const isReplicaCount = (v: string) => isPositiveInt(v) && Number(v) <= 100;
			const isPercent = (v: string) => isPositiveInt(v) && Number(v) <= 100;
			if (min && !isReplicaCount(min)) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a whole number between 1 and 100.', path: ['autoscaling', 'minReplicas'] });
			}
			if (!isReplicaCount(max)) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Set a maximum between 1 and 100.', path: ['autoscaling', 'maxReplicas'] });
			} else if (min && isReplicaCount(min) && Number(min) > Number(max)) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Min must be ≤ max.', path: ['autoscaling', 'minReplicas'] });
			}
			if (cpu && !isPercent(cpu)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Enter a percentage between 1 and 100.',
					path: ['autoscaling', 'targetCpuUtilizationPercentage']
				});
			}
			if (mem && !isPercent(mem)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Enter a percentage between 1 and 100.',
					path: ['autoscaling', 'targetMemoryUtilizationPercentage']
				});
			}
			if (!cpu && !mem) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Set at least one target (CPU or memory).',
					path: ['autoscaling', 'targetCpuUtilizationPercentage']
				});
			}
			// HPA needs the matching resource request to compute a utilisation percentage.
			if (cpu && !val.resources.cpuRequest.trim()) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Set a CPU request above to target CPU.',
					path: ['autoscaling', 'targetCpuUtilizationPercentage']
				});
			}
			if (mem && !val.resources.memoryRequest.trim()) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Set a memory request above to target memory.',
					path: ['autoscaling', 'targetMemoryUtilizationPercentage']
				});
			}
		}
	});

export type ServiceSettingsValues = z.infer<typeof serviceSettingsSchema>;

// Per-service wrapper so the volume no-shrink check can see original sizes (the static schema can't); renamed volumes count as new.
export function makeServiceSettingsSchema(type: Service['type'], originalVolumeSizes: Record<string, string>) {
	return serviceSettingsSchema.superRefine((val, ctx) => {
		// The type-specific field is required only for that type (image+tag vs dockerfile vs repo).
		if (type === 'dockerfile') {
			if (!val.dockerfile.trim()) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a Dockerfile.', path: ['dockerfile'] });
			} else if (!/^\s*FROM\s+\S+/im.test(val.dockerfile)) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A Dockerfile must contain a FROM instruction.', path: ['dockerfile'] });
			}
		} else if (type === 'public-repo') {
			if (!val.repoUrl.trim()) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a repository URL.', path: ['repoUrl'] });
			} else if (!/^https?:\/\/\S+$/i.test(val.repoUrl.trim())) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a public http(s) Git URL.', path: ['repoUrl'] });
			}
			if (!val.branch.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a branch.', path: ['branch'] });
			if (val.commit.trim() && !/^[0-9a-fA-F]{7,64}$/.test(val.commit.trim())) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid commit SHA.', path: ['commit'] });
			}
		} else if (type === 'private-repo') {
			if (!val.repoUrl.trim()) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a repository URL.', path: ['repoUrl'] });
			} else if (!isPrivateRepoSshUrl(val.repoUrl)) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: privateRepoSshUrlMessage, path: ['repoUrl'] });
			}
			if (!val.branch.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a branch.', path: ['branch'] });
			if (!val.sshKeyId.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a deploy key.', path: ['sshKeyId'] });
			if (val.commit.trim() && !/^[0-9a-fA-F]{7,64}$/.test(val.commit.trim())) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid commit SHA.', path: ['commit'] });
			}
		} else if (isDatabaseEngine(type)) {
			if (!val.version.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Pick a version.', path: ['version'] });
			// Storage is grow-only; the API enforces the no-shrink rule, here we only validate the quantity.
			if (!val.storage.trim() || !memoryRegex.test(val.storage.trim())) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a storage size like 1Gi.', path: ['storage'] });
			}
		} else {
			if (!val.image.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an image.', path: ['image'] });
			if (!val.tag.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a tag.', path: ['tag'] });
		}
		val.volumes.forEach((vol, i) => {
			const original = originalVolumeSizes[vol.name.trim()];
			if (!original) return;
			const originalBytes = parseQuantityToBytes(original);
			const nextBytes = parseQuantityToBytes(vol.size);
			if (originalBytes != null && nextBytes != null && nextBytes < originalBytes) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Volumes can only grow (was ${original}).`, path: ['volumes', i, 'size'] });
			}
		});
	});
}

export function snapshot(service: Service): ServiceSettingsValues {
	const hc = service.config.healthCheck;
	const res = service.config.resources;
	const as = service.config.autoscaling;

	return {
		name: service.name,
		description: service.description,
		image: 'image' in service.config ? service.config.image : '',
		tag: 'image' in service.config ? service.config.tag : '',
		dockerfile: 'dockerfile' in service.config ? service.config.dockerfile : '',
		repoUrl: 'repoUrl' in service.config ? service.config.repoUrl : '',
		branch: 'branch' in service.config ? service.config.branch : '',
		commit: 'commit' in service.config ? (service.config.commit ?? '') : '',
		rootDirectory: 'rootDirectory' in service.config ? (service.config.rootDirectory ?? '') : '',
		buildCommand: 'buildCommand' in service.config ? (service.config.buildCommand ?? '') : '',
		startCommand: 'startCommand' in service.config ? (service.config.startCommand ?? '') : '',
		sshKeyId: 'sshKeyId' in service.config ? service.config.sshKeyId : '',
		builder: 'builder' in service.config ? service.config.builder : 'nixpacks',
		dockerfilePath: 'dockerfilePath' in service.config ? (service.config.dockerfilePath ?? '') : '',
		version: 'version' in service.config ? service.config.version : '',
		storage: 'storage' in service.config ? service.config.storage.size : '',
		containerPort: service.config.containerPort?.toString() ?? '',
		defaultDomainEnabled: service.config.defaultDomainEnabled === true,
		env: service.config.env.map(entry => ({ _id: crypto.randomUUID(), key: entry.key, value: entry.value })),
		secrets: (service.config.secrets ?? []).map(entry => ({ _id: crypto.randomUUID(), key: entry.key, value: '', hasValue: entry.hasValue })),
		domains: (service.config.domains ?? []).map(entry => ({ _id: crypto.randomUUID(), host: entry.host, port: String(entry.port) })),
		volumes: (service.config.volumes ?? []).map(entry => ({
			_id: crypto.randomUUID(),
			name: entry.name,
			mountPath: entry.mountPath,
			size: entry.size,
			// Editable optional field; normalize to '' so every row has the key (uniform v-model binding). Submit drops it when blank.
			subPath: entry.subPath ?? ''
		})),
		// `configFiles` is a docker-image concept absent from the api-client config view type — read it loosely.
		configFiles: ((service.config as { configFiles?: ConfigFile[] }).configFiles ?? []).map(entry => ({
			_id: crypto.randomUUID(),
			path: entry.path,
			content: entry.content
		})),
		// command/args are absent from the api-client config view type — read them loosely like configFiles.
		command: ((service.config as { command?: string[] }).command ?? []).map(value => ({ _id: crypto.randomUUID(), value })),
		args: ((service.config as { args?: string[] }).args ?? []).map(value => ({ _id: crypto.randomUUID(), value })),
		healthCheck: {
			enabled: hc?.enabled ?? false,
			type: hc?.type ?? 'http',
			path: hc?.path ?? '',
			port: hc?.port?.toString() ?? '',
			initialDelaySeconds: hc?.initialDelaySeconds?.toString() ?? '',
			periodSeconds: hc?.periodSeconds?.toString() ?? '',
			timeoutSeconds: hc?.timeoutSeconds?.toString() ?? '',
			failureThreshold: hc?.failureThreshold?.toString() ?? '',
			successThreshold: hc?.successThreshold?.toString() ?? ''
		},
		resources: {
			cpuRequest: res?.cpuRequest ?? '',
			cpuLimit: res?.cpuLimit ?? '',
			memoryRequest: res?.memoryRequest ?? '',
			memoryLimit: res?.memoryLimit ?? ''
		},
		autoscaling: {
			enabled: as?.enabled ?? false,
			minReplicas: as?.minReplicas?.toString() ?? '',
			maxReplicas: as?.maxReplicas?.toString() ?? '',
			targetCpuUtilizationPercentage: as?.targetCpuUtilizationPercentage?.toString() ?? '',
			targetMemoryUtilizationPercentage: as?.targetMemoryUtilizationPercentage?.toString() ?? ''
		},
		autoDeploy: {
			enabled: service.autoDeploy?.enabled ?? false
		}
	};
}

// Cheap deep clone so `state` and the dirty-baseline don't share nested references.
export function clone(values: ServiceSettingsValues): ServiceSettingsValues {
	return JSON.parse(JSON.stringify(values)) as ServiceSettingsValues;
}
