import type {
	DatabaseEngine,
	DatabaseServiceConfig,
	DockerfileServiceConfig,
	DockerImageServiceConfig,
	PrivateRepoServiceConfig,
	PublicRepoServiceConfig,
	RuntimeConfig,
	ServiceConfig,
	ServiceConfigFile
} from '@kubwave/db';
import { DATABASE_ENGINE_CATALOG } from '@kubwave/db/database-engines';
import { decryptSecret, encryptSecret, generatePassword } from '@kubwave/crypto';
import type {
	DatabaseUpdateConfigInput,
	DockerfileConfigInput,
	DockerImageConfigInput,
	PrivateRepoConfigInput,
	PublicRepoConfigInput
} from './services.dto.js';
import type { ServiceConfigView } from './services.types.js';

export function toConfigView(stored: ServiceConfig): ServiceConfigView {
	const { secrets, configFiles, ...rest } = stored;
	const view = {
		...rest,
		domains: stored.domains ?? [],
		secrets: (secrets ?? []).map(secret => ({ key: secret.key, hasValue: true })),
		// Config files are decrypted for display so users can read/author their own configs.
		...(configFiles ? { configFiles: configFiles.map(file => ({ path: file.path, content: decryptSecret(file.content) })) } : {})
	};

	delete (view as { password?: string }).password;
	return view as ServiceConfigView;
}

function normalizeResources(resources: RuntimeConfig['resources']): RuntimeConfig['resources'] {
	if (!resources) return undefined;

	const normalized: NonNullable<RuntimeConfig['resources']> = {};
	const cpuRequest = resources.cpuRequest?.trim();
	const cpuLimit = resources.cpuLimit?.trim();
	const memoryRequest = resources.memoryRequest?.trim();
	const memoryLimit = resources.memoryLimit?.trim();

	if (cpuRequest) normalized.cpuRequest = cpuRequest;
	if (cpuLimit) normalized.cpuLimit = cpuLimit;
	if (memoryRequest) normalized.memoryRequest = memoryRequest;
	if (memoryLimit) normalized.memoryLimit = memoryLimit;

	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeAutoscaling(autoscaling: RuntimeConfig['autoscaling']): RuntimeConfig['autoscaling'] {
	if (!autoscaling?.enabled) return undefined;

	const normalized: NonNullable<RuntimeConfig['autoscaling']> = { enabled: true };
	if (autoscaling.minReplicas != null) normalized.minReplicas = autoscaling.minReplicas;
	if (autoscaling.maxReplicas != null) normalized.maxReplicas = autoscaling.maxReplicas;
	if (autoscaling.targetCpuUtilizationPercentage != null) normalized.targetCpuUtilizationPercentage = autoscaling.targetCpuUtilizationPercentage;
	if (autoscaling.targetMemoryUtilizationPercentage != null) {
		normalized.targetMemoryUtilizationPercentage = autoscaling.targetMemoryUtilizationPercentage;
	}

	return normalized;
}

function normalizeRuntime(config: RuntimeConfig): RuntimeConfig {
	const healthCheck = config.healthCheck;
	const resources = normalizeResources(config.resources);
	const autoscaling = normalizeAutoscaling(config.autoscaling);
	const secrets = (config.secrets ?? []).map(item => ({ key: item.key.trim(), value: item.value }));
	// Content is already ciphertext here (encrypted by resolveConfigFiles before normalize); just pass it through.
	const configFiles = (config.configFiles ?? []).map(file => ({ path: file.path.trim(), content: file.content }));

	return {
		containerPort: config.containerPort,
		...(config.defaultDomainEnabled === true ? { defaultDomainEnabled: true } : {}),
		env: config.env.map(item => ({ key: item.key.trim(), value: item.value.trim() })),
		...(secrets.length > 0 ? { secrets } : {}),
		domains: (config.domains ?? []).map(domain => ({ host: domain.host.trim(), port: domain.port })),
		volumes: (config.volumes ?? []).map(volume => ({
			name: volume.name.trim(),
			mountPath: volume.mountPath.trim(),
			size: volume.size.trim(),
			...(volume.subPath ? { subPath: volume.subPath.trim() } : {})
		})),
		...(configFiles.length > 0 ? { configFiles } : {}),
		...(config.command && config.command.length > 0 ? { command: config.command } : {}),
		...(config.args && config.args.length > 0 ? { args: config.args } : {}),
		...(healthCheck?.enabled
			? {
					healthCheck: {
						enabled: true,
						type: healthCheck.type,
						...(healthCheck.type === 'http' && healthCheck.path ? { path: healthCheck.path.trim() } : {}),
						...(healthCheck.port != null ? { port: healthCheck.port } : {}),
						...(healthCheck.initialDelaySeconds != null ? { initialDelaySeconds: healthCheck.initialDelaySeconds } : {}),
						...(healthCheck.periodSeconds != null ? { periodSeconds: healthCheck.periodSeconds } : {}),
						...(healthCheck.timeoutSeconds != null ? { timeoutSeconds: healthCheck.timeoutSeconds } : {}),
						...(healthCheck.failureThreshold != null ? { failureThreshold: healthCheck.failureThreshold } : {}),
						...(healthCheck.successThreshold != null ? { successThreshold: healthCheck.successThreshold } : {})
					}
				}
			: {}),
		...(resources ? { resources } : {}),
		...(autoscaling ? { autoscaling } : {})
	};
}

export function normalizeDockerConfig(config: DockerImageServiceConfig): DockerImageServiceConfig {
	return { image: config.image.trim(), tag: config.tag.trim(), ...normalizeRuntime(config) };
}

export function normalizeDockerfileConfig(config: DockerfileServiceConfig): DockerfileServiceConfig {
	return { dockerfile: config.dockerfile, ...normalizeRuntime(config) };
}

export function normalizePublicRepoConfig(config: PublicRepoServiceConfig): PublicRepoServiceConfig {
	const commit = config.commit?.trim();
	const rootDirectory = config.rootDirectory?.trim();
	const isDockerfile = config.builder === 'dockerfile';
	const dockerfilePath = config.dockerfilePath?.trim();
	const buildCommand = config.buildCommand?.trim();
	const startCommand = config.startCommand?.trim();

	return {
		repoUrl: config.repoUrl.trim(),
		branch: config.branch.trim(),
		builder: config.builder,
		...(commit ? { commit } : {}),
		...(rootDirectory ? { rootDirectory } : {}),
		...(isDockerfile && dockerfilePath ? { dockerfilePath } : {}),
		...(!isDockerfile && buildCommand ? { buildCommand } : {}),
		...(!isDockerfile && startCommand ? { startCommand } : {}),
		...normalizeRuntime(config)
	};
}

export function normalizePrivateRepoConfig(config: PrivateRepoServiceConfig): PrivateRepoServiceConfig {
	const { sshKeyId, ...rest } = config;
	return { ...normalizePublicRepoConfig(rest as PublicRepoServiceConfig), sshKeyId: sshKeyId.trim() };
}

export function resolveSecrets(
	incoming: DockerImageConfigInput['secrets'],
	existing: RuntimeConfig['secrets']
): Array<{ key: string; value: string }> {
	const existingByKey = new Map((existing ?? []).map(secret => [secret.key, secret.value]));
	const out: Array<{ key: string; value: string }> = [];

	for (const item of incoming ?? []) {
		const key = item.key.trim();
		if (!key) continue;

		if (item.value !== null) {
			out.push({ key, value: encryptSecret(item.value) });
		} else {
			const previous = existingByKey.get(key);
			if (previous !== undefined) out.push({ key, value: previous });
		}
	}

	return out;
}

// Encrypt each file's content at rest (it can carry credentials, like kong.yml's service_role key).
export function resolveConfigFiles(incoming: DockerImageConfigInput['configFiles']): ServiceConfigFile[] {
	const out: ServiceConfigFile[] = [];
	for (const item of incoming ?? []) {
		const path = item.path.trim();
		if (!path) continue;
		out.push({ path, content: encryptSecret(item.content) });
	}
	return out;
}

export function buildStoredConfig(input: DockerImageConfigInput, existingSecrets: RuntimeConfig['secrets']): DockerImageServiceConfig {
	return normalizeDockerConfig({
		...input,
		secrets: resolveSecrets(input.secrets, existingSecrets),
		configFiles: resolveConfigFiles(input.configFiles)
	});
}

export function buildStoredDockerfileConfig(input: DockerfileConfigInput, existingSecrets: RuntimeConfig['secrets']): DockerfileServiceConfig {
	return normalizeDockerfileConfig({ ...input, secrets: resolveSecrets(input.secrets, existingSecrets) });
}

export function buildStoredPublicRepoConfig(input: PublicRepoConfigInput, existingSecrets: RuntimeConfig['secrets']): PublicRepoServiceConfig {
	return normalizePublicRepoConfig({ ...input, secrets: resolveSecrets(input.secrets, existingSecrets) });
}

export function buildStoredPrivateRepoConfig(input: PrivateRepoConfigInput, existingSecrets: RuntimeConfig['secrets']): PrivateRepoServiceConfig {
	return normalizePrivateRepoConfig({ ...input, secrets: resolveSecrets(input.secrets, existingSecrets) });
}

function normalizeDatabaseConfig(
	engine: DatabaseEngine,
	input: DatabaseUpdateConfigInput,
	password: string,
	existingSecrets: RuntimeConfig['secrets']
): DatabaseServiceConfig {
	const resources = normalizeResources(input.resources);
	const secrets = resolveSecrets(input.secrets, existingSecrets);
	const database = input.database?.trim();
	const username = input.username?.trim();

	return {
		containerPort: DATABASE_ENGINE_CATALOG[engine].port,
		env: input.env.map(item => ({ key: item.key.trim(), value: item.value.trim() })),
		...(secrets.length > 0 ? { secrets } : {}),
		domains: [],
		volumes: [],
		...(resources ? { resources } : {}),
		version: input.version.trim(),
		storage: { size: input.storage.size.trim() },
		...(database ? { database } : {}),
		...(username ? { username } : {}),
		password
	};
}

export function buildStoredDatabaseConfig(
	engine: DatabaseEngine,
	input: DatabaseUpdateConfigInput,
	existing: { secrets: RuntimeConfig['secrets']; password: string } | null
): DatabaseServiceConfig {
	const password = existing?.password ?? encryptSecret(generatePassword());
	return normalizeDatabaseConfig(engine, input, password, existing?.secrets);
}
