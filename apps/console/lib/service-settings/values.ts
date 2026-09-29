import type { Service } from '@/lib/api/types';
import { uuid } from '@/lib/uuid';

// Editable state of one service. Every type-specific field coexists so one form (and one staged
// draft) can hold any service shape; the update builder picks what each type sends. Numbers stay
// strings while editing. `_id` is a stable, ui-only row key.
export type Row<T> = T & { _id: string };

export type ServiceSettingsValues = {
	name: string;
	description: string;
	image: string;
	tag: string;
	dockerfile: string;
	repoUrl: string;
	branch: string;
	commit: string;
	rootDirectory: string;
	watchPaths: string;
	watchEntireRepo: boolean;
	buildCommand: string;
	startCommand: string;
	sshKeyId: string;
	installationId: string;
	repoFullName: string;
	builder: string;
	dockerfilePath: string;
	version: string;
	storage: string;
	containerPort: string;
	defaultDomainEnabled: boolean;
	env: Row<{ key: string; value: string }>[];
	// `value` is newly typed plaintext; `hasValue` means the API stores one. Blank + hasValue keeps it.
	secrets: Row<{ key: string; value: string; hasValue: boolean }>[];
	domains: Row<{ host: string; port: string }>[];
	// publicPort is allocated by the API on save; read-only here.
	exposedPorts: Row<{ containerPort: string; publicPort: string }>[];
	volumes: Row<{ name: string; mountPath: string; size: string; subPath: string }>[];
	configFiles: Row<{ path: string; content: string }>[];
	command: Row<{ value: string }>[];
	args: Row<{ value: string }>[];
	healthCheck: {
		enabled: boolean;
		type: 'http' | 'tcp';
		path: string;
		port: string;
		initialDelaySeconds: string;
		periodSeconds: string;
		timeoutSeconds: string;
		failureThreshold: string;
		successThreshold: string;
	};
	resources: { cpuRequest: string; cpuLimit: string; memoryRequest: string; memoryLimit: string };
	autoscaling: {
		enabled: boolean;
		minReplicas: string;
		maxReplicas: string;
		targetCpuUtilizationPercentage: string;
		targetMemoryUtilizationPercentage: string;
	};
	// One public path per line (e.g. /health or /api/*).
	basicAuth: { enabled: boolean; username: string; password: string; publicPaths: string; hasPassword: boolean };
	registryAuth: { enabled: boolean; server: string; username: string; password: string; hasPassword: boolean };
	autoDeploy: { enabled: boolean };
	imageWatch: { enabled: boolean };
};

export const rowId = uuid;

// Fields the API returns for docker-image services that the typed config view does not declare.
type LooseConfig = {
	configFiles?: Array<{ path: string; content: string }>;
	command?: string[];
	args?: string[];
	basicAuth?: { enabled?: boolean; username?: string; hasPassword?: boolean; publicPaths?: string[] };
	registryAuth?: { enabled?: boolean; server?: string; username?: string; hasPassword?: boolean };
};

const text = (value: number | null | undefined) => value?.toString() ?? '';

function pick<K extends string>(config: Service['config'], key: K): unknown {
	return (config as unknown as Record<string, unknown>)[key];
}

const str = (config: Service['config'], key: string) => {
	const value = pick(config, key);
	return typeof value === 'string' ? value : '';
};

export function snapshotService(service: Service): ServiceSettingsValues {
	const config = service.config;
	const loose = config as LooseConfig;
	const hc = config.healthCheck;
	const as = config.autoscaling;
	const storage = pick(config, 'storage') as { size?: string } | undefined;
	const watchPaths = pick(config, 'watchPaths');

	return {
		name: service.name,
		description: service.description,
		image: str(config, 'image'),
		tag: str(config, 'tag'),
		dockerfile: str(config, 'dockerfile'),
		repoUrl: str(config, 'repoUrl'),
		branch: str(config, 'branch'),
		commit: str(config, 'commit'),
		rootDirectory: str(config, 'rootDirectory'),
		watchPaths: Array.isArray(watchPaths) ? watchPaths.join('\n') : '',
		watchEntireRepo: pick(config, 'watchEntireRepo') === true,
		buildCommand: str(config, 'buildCommand'),
		startCommand: str(config, 'startCommand'),
		sshKeyId: str(config, 'sshKeyId'),
		installationId: str(config, 'installationId'),
		repoFullName: str(config, 'repoFullName'),
		builder: str(config, 'builder') || 'nixpacks',
		dockerfilePath: str(config, 'dockerfilePath'),
		version: str(config, 'version'),
		storage: storage?.size ?? '',
		containerPort: text(config.containerPort),
		defaultDomainEnabled: config.defaultDomainEnabled === true,
		env: config.env.map(({ key, value }) => ({ _id: rowId(), key, value })),
		secrets: (config.secrets ?? []).map(({ key, hasValue }) => ({ _id: rowId(), key, value: '', hasValue })),
		domains: (config.domains ?? []).map(({ host, port }) => ({ _id: rowId(), host, port: String(port) })),
		exposedPorts: (config.exposedPorts ?? []).map(({ containerPort, publicPort }) => ({
			_id: rowId(),
			containerPort: String(containerPort),
			publicPort: String(publicPort)
		})),
		volumes: (config.volumes ?? []).map(({ name, mountPath, size, subPath }) => ({ _id: rowId(), name, mountPath, size, subPath: subPath ?? '' })),
		configFiles: (loose.configFiles ?? []).map(({ path, content }) => ({ _id: rowId(), path, content })),
		command: (loose.command ?? []).map(value => ({ _id: rowId(), value })),
		args: (loose.args ?? []).map(value => ({ _id: rowId(), value })),
		healthCheck: {
			enabled: hc?.enabled ?? false,
			type: hc?.type ?? 'http',
			path: hc?.path ?? '',
			port: text(hc?.port),
			initialDelaySeconds: text(hc?.initialDelaySeconds),
			periodSeconds: text(hc?.periodSeconds),
			timeoutSeconds: text(hc?.timeoutSeconds),
			failureThreshold: text(hc?.failureThreshold),
			successThreshold: text(hc?.successThreshold)
		},
		resources: {
			cpuRequest: config.resources?.cpuRequest ?? '',
			cpuLimit: config.resources?.cpuLimit ?? '',
			memoryRequest: config.resources?.memoryRequest ?? '',
			memoryLimit: config.resources?.memoryLimit ?? ''
		},
		autoscaling: {
			enabled: as?.enabled ?? false,
			minReplicas: text(as?.minReplicas),
			maxReplicas: text(as?.maxReplicas),
			targetCpuUtilizationPercentage: text(as?.targetCpuUtilizationPercentage),
			targetMemoryUtilizationPercentage: text(as?.targetMemoryUtilizationPercentage)
		},
		basicAuth: {
			enabled: loose.basicAuth?.enabled ?? false,
			username: loose.basicAuth?.username ?? '',
			password: '',
			publicPaths: (loose.basicAuth?.publicPaths ?? []).join('\n'),
			hasPassword: loose.basicAuth?.hasPassword ?? false
		},
		registryAuth: {
			enabled: loose.registryAuth?.enabled ?? false,
			server: loose.registryAuth?.server ?? '',
			username: loose.registryAuth?.username ?? '',
			password: '',
			hasPassword: loose.registryAuth?.hasPassword ?? false
		},
		autoDeploy: { enabled: service.autoDeploy?.enabled ?? false },
		imageWatch: { enabled: service.imageWatch?.enabled ?? false }
	};
}
