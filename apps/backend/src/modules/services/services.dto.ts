import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { DATABASE_ENGINE_CATALOG, DATABASE_ENGINES } from '@kubwave/db/database-engines';
import type { DatabaseEngine } from '@kubwave/db';
import { fileKey } from '@kubwave/kube';
import type { ServiceConfigView, ServiceConnectionView, ServiceView } from './services.types.js';

const envKeySchema = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const dockerEnvVarSchema = z.object({
	key: envKeySchema,
	value: z.string().max(4000)
});

export const dockerSecretInputSchema = z.object({
	key: envKeySchema,
	value: z.string().max(4000).nullable()
});

export const serviceDomainSchema = z.object({
	host: z
		.string()
		.trim()
		.min(1)
		.max(253)
		.regex(/^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/, 'Enter a valid hostname'),
	port: z.number().int().min(1).max(65535)
});

const quantityRegex = /^\d+(\.\d+)?[EPTGMK]i?$/;
const cpuRegex = /^(\d+(\.\d+)?|\d+m)$/;

export const resourceConfigSchema = z.object({
	cpuRequest: z.string().trim().max(20).regex(cpuRegex, 'Enter a valid CPU quantity (e.g. 250m, 1)').optional(),
	cpuLimit: z.string().trim().max(20).regex(cpuRegex, 'Enter a valid CPU quantity (e.g. 500m, 2)').optional(),
	memoryRequest: z.string().trim().max(20).regex(quantityRegex, 'Enter a valid memory quantity (e.g. 256Mi, 1Gi)').optional(),
	memoryLimit: z.string().trim().max(20).regex(quantityRegex, 'Enter a valid memory quantity (e.g. 512Mi, 1Gi)').optional()
});

// Reject `..` segments so a path can't escape its intended mount location (parity with repo path fields below).
const noTraversal = (value: string) => !value.split('/').includes('..');

// Clean relative subPath (no blank/'.'/'..' segments) so it can't escape the volume or drift against the kubelet's normalized form.
const isCleanRelativeSubPath = (value: string) => value.split('/').every(seg => seg.trim().length > 0 && seg !== '.' && seg !== '..');

export const serviceVolumeSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1)
		.max(63)
		.regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Must be a valid Kubernetes volume name.'),
	mountPath: z.string().trim().min(1).max(512).startsWith('/'),
	size: z.string().trim().min(1).max(20).regex(quantityRegex, 'Enter a valid Kubernetes quantity (e.g. 1Gi, 500Mi).'),
	subPath: z
		.string()
		.trim()
		.min(1)
		.max(512)
		.regex(/^[^/]/, 'Must be a relative path without a leading slash.')
		.refine(isCleanRelativeSubPath, 'Must not contain empty, "." or ".." path segments.')
		.optional()
});

export const autoscalingConfigSchema = z.object({
	enabled: z.boolean(),
	minReplicas: z.number().int().min(1).max(100).optional(),
	maxReplicas: z.number().int().min(1).max(100).optional(),
	targetCpuUtilizationPercentage: z.number().int().min(1).max(100).optional(),
	targetMemoryUtilizationPercentage: z.number().int().min(1).max(100).optional()
});

export const healthCheckSchema = z
	.object({
		enabled: z.boolean(),
		type: z.enum(['http', 'tcp']),
		path: z.string().trim().min(1).max(2000).optional(),
		port: z.number().int().min(1).max(65535).optional(),
		initialDelaySeconds: z.number().int().min(0).max(600).optional(),
		periodSeconds: z.number().int().min(1).max(120).optional(),
		timeoutSeconds: z.number().int().min(1).max(60).optional(),
		failureThreshold: z.number().int().min(1).max(10).optional(),
		successThreshold: z.number().int().min(1).max(10).optional()
	})
	.superRefine((val, ctx) => {
		if (val.enabled && val.type === 'http' && !val.path) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Path is required for HTTP health checks.', path: ['path'] });
		}
	});

export const serviceConfigFileSchema = z.object({
	path: z.string().trim().min(1).max(512).startsWith('/').refine(noTraversal, 'Path cannot contain "..".'),
	content: z.string().max(131072)
});

const runtimeConfigBase = z.object({
	containerPort: z.number().int().min(1).max(65535).nullable(),
	defaultDomainEnabled: z.boolean().optional(),
	env: z.array(dockerEnvVarSchema).max(100),
	secrets: z.array(dockerSecretInputSchema).max(100).default([]),
	domains: z.array(serviceDomainSchema).max(20).default([]),
	volumes: z.array(serviceVolumeSchema).max(10).default([]),
	healthCheck: healthCheckSchema.optional(),
	resources: resourceConfigSchema.optional(),
	autoscaling: autoscalingConfigSchema.optional()
});

const dockerImageConfigBase = runtimeConfigBase.extend({
	image: z.string().trim().min(1).max(255),
	tag: z.string().trim().min(1).max(128),
	// Config files are a docker-image concern (e.g. Supabase Kong/init SQL); other builders don't take them.
	configFiles: z.array(serviceConfigFileSchema).max(20).default([]),
	command: z.array(z.string().max(4096)).max(64).optional(),
	args: z.array(z.string().max(4096)).max(64).optional()
});

function refineRuntimeConfig(val: z.infer<typeof runtimeConfigBase>, ctx: z.RefinementCtx): void {
	if (val.healthCheck?.enabled && val.healthCheck.port == null && val.containerPort == null) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Set a health check port, or a container port to probe.',
			path: ['healthCheck', 'port']
		});
	}

	const autoscaling = val.autoscaling;
	if (autoscaling?.enabled && val.volumes.length > 0) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Autoscaling cannot be enabled for a service with a persistent volume.',
			path: ['autoscaling', 'enabled']
		});
	}

	if (!autoscaling?.enabled) return;

	if (autoscaling.maxReplicas == null) {
		ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Set a maximum number of replicas.', path: ['autoscaling', 'maxReplicas'] });
	} else if (autoscaling.minReplicas != null && autoscaling.minReplicas > autoscaling.maxReplicas) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Min replicas must be less than or equal to max replicas.',
			path: ['autoscaling', 'minReplicas']
		});
	}

	if (autoscaling.targetCpuUtilizationPercentage == null && autoscaling.targetMemoryUtilizationPercentage == null) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Set at least one target, CPU or memory utilization.',
			path: ['autoscaling', 'targetCpuUtilizationPercentage']
		});
	}

	if (autoscaling.targetCpuUtilizationPercentage != null && !val.resources?.cpuRequest) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'A CPU request is required to target CPU utilization.',
			path: ['autoscaling', 'targetCpuUtilizationPercentage']
		});
	}

	if (autoscaling.targetMemoryUtilizationPercentage != null && !val.resources?.memoryRequest) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'A memory request is required to target memory utilization.',
			path: ['autoscaling', 'targetMemoryUtilizationPercentage']
		});
	}
}

// Headroom under the 1 MiB Kubernetes Secret limit, which the rendered config-files Secret must fit within.
const CONFIG_FILES_MAX_TOTAL_BYTES = 900 * 1024;

function refineConfigFiles(val: z.infer<typeof dockerImageConfigBase>, ctx: z.RefinementCtx): void {
	// A fileKey collision would silently drop a file, so reject duplicate paths and distinct paths that map to the same key.
	const byKey = new Map<string, string>();
	let totalBytes = 0;
	val.configFiles.forEach((file, i) => {
		totalBytes += Buffer.byteLength(file.content, 'utf8');
		const key = fileKey(file.path);
		const prior = byKey.get(key);
		if (prior === undefined) {
			byKey.set(key, file.path);
		} else {
			const message =
				prior === file.path ? 'Each config file must have a unique path.' : `Path conflicts with "${prior}" — both map to the same mounted file.`;
			ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['configFiles', i, 'path'] });
		}
	});
	if (totalBytes > CONFIG_FILES_MAX_TOTAL_BYTES) {
		ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Config files exceed the total size limit (about 900 KB).', path: ['configFiles'] });
	}
}

export const dockerImageConfigSchema = dockerImageConfigBase.superRefine(refineRuntimeConfig).superRefine(refineConfigFiles);
export type DockerImageConfigInput = z.infer<typeof dockerImageConfigSchema>;

const dockerfileConfigBase = runtimeConfigBase.extend({
	dockerfile: z
		.string()
		.trim()
		.min(1)
		.max(100_000)
		.refine(value => value.split('\n').some(line => /^\s*FROM\s+\S+/i.test(line)), 'A Dockerfile must contain a FROM instruction.')
});

export const dockerfileConfigSchema = dockerfileConfigBase.superRefine(refineRuntimeConfig);
export type DockerfileConfigInput = z.infer<typeof dockerfileConfigSchema>;

const gitRefRegex = /^[A-Za-z0-9._/-]+$/;

const publicRepoConfigBase = runtimeConfigBase.extend({
	repoUrl: z
		.string()
		.trim()
		.min(1)
		.max(512)
		.regex(/^https?:\/\/\S+$/i, 'Enter a public http(s) Git URL.'),
	branch: z
		.string()
		.trim()
		.min(1)
		.max(255)
		.regex(gitRefRegex, 'Enter a valid branch name.')
		.refine(noTraversal, 'Invalid branch name.')
		.default('main'),
	commit: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{7,64}$/, 'Enter a valid commit SHA.')
		.or(z.literal(''))
		.optional(),
	rootDirectory: z
		.string()
		.trim()
		.max(255)
		.regex(gitRefRegex, 'Enter a valid sub-directory.')
		.refine(noTraversal, 'Sub-directory cannot traverse outside the repo.')
		.optional(),
	buildCommand: z.string().trim().max(4000).optional(),
	startCommand: z.string().trim().max(4000).optional(),
	builder: z.enum(['nixpacks', 'dockerfile']).default('nixpacks'),
	dockerfilePath: z
		.string()
		.trim()
		.max(255)
		.regex(gitRefRegex, 'Enter a valid Dockerfile path.')
		.refine(noTraversal, 'Dockerfile path cannot traverse outside the repo.')
		.optional()
});

export const publicRepoConfigSchema = publicRepoConfigBase.superRefine(refineRuntimeConfig);
export type PublicRepoConfigInput = z.infer<typeof publicRepoConfigSchema>;

function isPrivateRepoSshUrl(value: string): boolean {
	const raw = value.trim();
	if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+$/.test(raw)) return true;
	if (!raw.startsWith('ssh://')) return false;
	if (/^ssh:\/\/[^/\s]+:(?=\/)/.test(raw)) return false;

	try {
		const url = new URL(raw);
		if (url.protocol !== 'ssh:' || !url.hostname || !url.pathname || url.pathname === '/') return false;
		if (!url.port) return true;
		const port = Number(url.port);
		return Number.isInteger(port) && port >= 1 && port <= 65535;
	} catch {
		return false;
	}
}

const privateRepoConfigBase = publicRepoConfigBase.extend({
	repoUrl: z
		.string()
		.trim()
		.min(1)
		.max(512)
		.refine(isPrivateRepoSshUrl, 'Enter an SSH Git URL, e.g. git@github.com:org/repo.git or ssh://git@host:2222/org/repo.git.'),
	sshKeyId: z.string().uuid('Select a deploy key.')
});

export const privateRepoConfigSchema = privateRepoConfigBase.superRefine(refineRuntimeConfig);
export type PrivateRepoConfigInput = z.infer<typeof privateRepoConfigSchema>;

const dbIdentifierSchema = z
	.string()
	.trim()
	.min(1)
	.max(63)
	.regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, digits, and underscores; start with a letter.');

const databaseStorageSchema = z
	.object({
		size: z.string().trim().min(1).max(20).regex(quantityRegex, 'Enter a valid Kubernetes quantity (e.g. 1Gi, 10Gi).')
	})
	.default({ size: '1Gi' });

const databaseConfigShape = {
	storage: databaseStorageSchema,
	database: dbIdentifierSchema.optional(),
	username: dbIdentifierSchema.optional(),
	resources: resourceConfigSchema.optional(),
	env: z.array(dockerEnvVarSchema).max(100).default([]),
	secrets: z.array(dockerSecretInputSchema).max(100).default([])
};

function databaseCreateConfigSchema(engine: DatabaseEngine) {
	const versions = DATABASE_ENGINE_CATALOG[engine].versions.allowed;
	return z.object({ version: z.enum(versions as [string, ...string[]]), ...databaseConfigShape });
}

export const postgresConfigSchema = databaseCreateConfigSchema('postgres');
export const mysqlConfigSchema = databaseCreateConfigSchema('mysql');
export const mariadbConfigSchema = databaseCreateConfigSchema('mariadb');
export const mongodbConfigSchema = databaseCreateConfigSchema('mongodb');

export const databaseUpdateConfigSchema = z.object({ version: z.string().trim().min(1).max(32), ...databaseConfigShape });
export type DatabaseUpdateConfigInput = z.infer<typeof databaseUpdateConfigSchema>;

export const autoDeployInputSchema = z.object({
	enabled: z.boolean().default(false)
});
export type AutoDeployInput = z.infer<typeof autoDeployInputSchema>;

export const serviceTypeSchema = z.enum(['docker-image', 'dockerfile', 'public-repo', 'private-repo', 'postgres', 'mysql', 'mariadb', 'mongodb']);
export const serviceTypes = serviceTypeSchema.options;

const createServiceCommonFields = {
	name: z.string().trim().min(1).max(100),
	description: z.string().trim().max(1000).optional()
};

export const createServiceSchema = z.discriminatedUnion('type', [
	z.object({ ...createServiceCommonFields, type: z.literal('docker-image'), config: dockerImageConfigSchema }),
	z.object({ ...createServiceCommonFields, type: z.literal('dockerfile'), config: dockerfileConfigSchema }),
	z.object({
		...createServiceCommonFields,
		type: z.literal('public-repo'),
		config: publicRepoConfigSchema,
		autoDeploy: autoDeployInputSchema.optional()
	}),
	z.object({
		...createServiceCommonFields,
		type: z.literal('private-repo'),
		config: privateRepoConfigSchema,
		autoDeploy: autoDeployInputSchema.optional()
	}),
	z.object({ ...createServiceCommonFields, type: z.literal('postgres'), config: postgresConfigSchema }),
	z.object({ ...createServiceCommonFields, type: z.literal('mysql'), config: mysqlConfigSchema }),
	z.object({ ...createServiceCommonFields, type: z.literal('mariadb'), config: mariadbConfigSchema }),
	z.object({ ...createServiceCommonFields, type: z.literal('mongodb'), config: mongodbConfigSchema })
]);

export const updateServiceSchema = z.object({
	name: z.string().trim().min(1).max(100).optional(),
	description: z.string().trim().max(1000).optional(),
	config: z
		.union([dockerImageConfigSchema, dockerfileConfigSchema, publicRepoConfigSchema, privateRepoConfigSchema, databaseUpdateConfigSchema])
		.optional(),
	autoDeploy: autoDeployInputSchema.optional()
});

export const createComposeServicesSchema = z.object({
	compose: z.string().trim().min(1).max(200_000)
});

export const serviceIdParamSchema = z.object({ serviceId: z.string().uuid() });
export const environmentServiceParamSchema = z.object({ environmentId: z.string().uuid() });

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type CreateComposeServicesInput = z.infer<typeof createComposeServicesSchema>;
export type ServiceIdParam = z.infer<typeof serviceIdParamSchema>;
export type EnvironmentServiceParam = z.infer<typeof environmentServiceParamSchema>;

export class AutoDeployInputDto implements AutoDeployInput {
	@ApiProperty({ type: Boolean, default: false })
	enabled!: boolean;
}

export class AutoDeployViewDto {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;

	@ApiProperty({ type: String, nullable: true })
	lastPolledCommit!: string | null;

	@ApiProperty({ type: String, nullable: true })
	lastPolledAt!: string | null;

	@ApiProperty({ type: String, nullable: true })
	nextPollAt!: string | null;

	@ApiProperty({ type: String, nullable: true })
	lastPollError!: string | null;
}

export class CreateServiceDto {
	@ApiProperty({ type: String, minLength: 1, maxLength: 100 })
	name!: string;

	@ApiPropertyOptional({ type: String, maxLength: 1000 })
	description?: string;

	@ApiProperty({ enum: serviceTypes })
	type!: CreateServiceInput['type'];

	@ApiProperty({ type: Object, additionalProperties: true })
	config!: Record<string, unknown>;

	@ApiPropertyOptional({ type: AutoDeployInputDto })
	autoDeploy?: AutoDeployInputDto;
}

export class UpdateServiceDto {
	@ApiPropertyOptional({ type: String, minLength: 1, maxLength: 100 })
	name?: string;

	@ApiPropertyOptional({ type: String, maxLength: 1000 })
	description?: string;

	@ApiPropertyOptional({ type: Object, additionalProperties: true })
	config?: Record<string, unknown>;

	@ApiPropertyOptional({ type: AutoDeployInputDto })
	autoDeploy?: AutoDeployInputDto;
}

export class CreateComposeServicesDto implements CreateComposeServicesInput {
	@ApiProperty({ type: String, minLength: 1, maxLength: 200_000 })
	compose!: string;
}

export class ServiceViewDto implements ServiceView {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String, format: 'uuid' })
	environmentId!: string;

	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: String })
	description!: string;

	@ApiProperty({ enum: serviceTypes })
	type!: ServiceView['type'];

	@ApiProperty({ type: Object, additionalProperties: true })
	config!: ServiceConfigView;

	@ApiProperty({ type: AutoDeployViewDto })
	autoDeploy!: AutoDeployViewDto;

	@ApiProperty({ type: String, nullable: true })
	internalDomain!: string | null;

	@ApiProperty({ type: String, nullable: true })
	defaultUrl!: string | null;

	@ApiProperty({ type: String })
	createdAt!: string;

	@ApiProperty({ type: String })
	updatedAt!: string;
}

export class ServiceConnectionDto implements ServiceConnectionView {
	@ApiProperty({ enum: DATABASE_ENGINES })
	engine!: ServiceConnectionView['engine'];

	@ApiProperty({ type: String })
	host!: string;

	@ApiProperty({ type: Number })
	port!: number;

	@ApiProperty({ type: String })
	username!: string;

	@ApiProperty({ type: String })
	database!: string;

	@ApiProperty({ type: String })
	password!: string;

	@ApiProperty({ type: String })
	uri!: string;
}

export class ServiceOkDto {
	@ApiProperty({ type: Boolean })
	ok!: true;
}
