import type {
	BasicAuthConfig,
	DatabaseEngine,
	DatabaseServiceConfig,
	DockerfileServiceConfig,
	DockerImageServiceConfig,
	GithubRepoServiceConfig,
	PrivateRepoServiceConfig,
	PublicRepoServiceConfig,
	RuntimeConfig,
	ServiceConfig,
	ServiceConfigFile
} from '@kubwave/db';
import { DATABASE_ENGINE_CATALOG } from '@kubwave/db/database-engines';
import { decryptSecret, encryptSecret, generatePassword } from '@kubwave/crypto';
import { ApiError } from '../../shared/errors/api-error';
import type {
	DatabaseUpdateConfigInput,
	DockerfileConfigInput,
	DockerImageConfigInput,
	GithubRepoConfigInput,
	PrivateRepoConfigInput,
	PublicRepoConfigInput
} from './services.dto.js';
import type { BasicAuthView, ServiceConfigView } from './services.types.js';

function toBasicAuthView(stored: BasicAuthConfig | undefined): BasicAuthView | undefined {
	if (!stored) return undefined;
	return { enabled: true, username: stored.username, hasPassword: true };
}

export function toConfigView(stored: ServiceConfig): ServiceConfigView {
	const { secrets, configFiles, basicAuth, ...rest } = stored;
	const basicAuthView = toBasicAuthView(basicAuth);
	const view = {
		...rest,
		domains: stored.domains ?? [],
		secrets: (secrets ?? []).map(secret => ({ key: secret.key, hasValue: true })),
		// Config files are decrypted for display so users can read/author their own configs.
		...(configFiles ? { configFiles: configFiles.map(file => ({ path: file.path, content: decryptSecret(file.content) })) } : {}),
		...(basicAuthView ? { basicAuth: basicAuthView } : {})
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
	const secrets = (config.secrets ?? []).filter(item => item?.key != null).map(item => ({ key: item.key.trim(), value: item.value }));
	// Content is already ciphertext here (encrypted by resolveConfigFiles before normalize); just pass it through.
	const configFiles = (config.configFiles ?? []).filter(file => file?.path != null).map(file => ({ path: file.path.trim(), content: file.content }));

	return {
		containerPort: config.containerPort,
		...(config.defaultDomainEnabled === true ? { defaultDomainEnabled: true } : {}),
		env: (config.env ?? [])
			.filter(item => item?.key != null && item?.value != null)
			.map(item => ({ key: item.key.trim(), value: item.value.trim() })),
		...(secrets.length > 0 ? { secrets } : {}),
		domains: (config.domains ?? []).filter(domain => domain?.host != null).map(domain => ({ host: domain.host.trim(), port: domain.port })),
		volumes: (config.volumes ?? [])
			.filter(volume => volume?.name != null && volume?.mountPath != null && volume?.size != null)
			.map(volume => ({
				name: volume.name.trim(),
				mountPath: volume.mountPath.trim(),
				size: volume.size.trim(),
				...(volume.subPath ? { subPath: volume.subPath.trim() } : {})
			})),
		...(configFiles.length > 0 ? { configFiles } : {}),
		...(config.command && config.command.length > 0 ? { command: config.command } : {}),
		...(config.args && config.args.length > 0 ? { args: config.args } : {}),
		...(config.basicAuth?.username != null ? { basicAuth: { username: config.basicAuth.username.trim(), password: config.basicAuth.password } } : {}),
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

export function normalizeGithubRepoConfig(config: GithubRepoServiceConfig): GithubRepoServiceConfig {
	const { installationId, repoFullName, ...rest } = config;
	return { ...normalizePublicRepoConfig(rest as PublicRepoServiceConfig), installationId: installationId.trim(), repoFullName: repoFullName.trim() };
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

export function resolveBasicAuth(
	incoming: { enabled: boolean; username?: string; password?: string | null } | undefined,
	existing: BasicAuthConfig | undefined
): BasicAuthConfig | undefined {
	if (!incoming?.enabled) return undefined;
	const username = incoming.username?.trim();
	if (!username) {
		throw new ApiError(400, 'A username is required when basic auth is enabled.');
	}

	if (incoming.password != null) return { username, password: encryptSecret(incoming.password) };
	if (existing) return { username, password: existing.password };
	throw new ApiError(400, 'A password is required when enabling basic auth.');
}

function withResolvedSensitive<
	T extends { secrets: DockerImageConfigInput['secrets']; basicAuth?: { enabled: boolean; username?: string; password?: string | null } }
>(
	input: T,
	existingSecrets: RuntimeConfig['secrets'],
	existingBasicAuth: BasicAuthConfig | undefined
): Omit<T, 'secrets' | 'basicAuth'> & { secrets: Array<{ key: string; value: string }>; basicAuth?: BasicAuthConfig } {
	const basicAuth = resolveBasicAuth(input.basicAuth, existingBasicAuth);
	return { ...input, secrets: resolveSecrets(input.secrets, existingSecrets), basicAuth };
}

// exposedPorts is handled by the service layer (server-allocated public ports), never by config normalization.
export function buildStoredConfig(
	input: Omit<DockerImageConfigInput, 'exposedPorts'>,
	existingSecrets: RuntimeConfig['secrets'],
	existingBasicAuth?: BasicAuthConfig
): DockerImageServiceConfig {
	return normalizeDockerConfig({
		...withResolvedSensitive(input, existingSecrets, existingBasicAuth),
		configFiles: resolveConfigFiles(input.configFiles)
	});
}

export function buildStoredDockerfileConfig(
	input: Omit<DockerfileConfigInput, 'exposedPorts'>,
	existingSecrets: RuntimeConfig['secrets'],
	existingBasicAuth?: BasicAuthConfig
): DockerfileServiceConfig {
	return normalizeDockerfileConfig(withResolvedSensitive(input, existingSecrets, existingBasicAuth));
}

export function buildStoredPublicRepoConfig(
	input: Omit<PublicRepoConfigInput, 'exposedPorts'>,
	existingSecrets: RuntimeConfig['secrets'],
	existingBasicAuth?: BasicAuthConfig
): PublicRepoServiceConfig {
	return normalizePublicRepoConfig(withResolvedSensitive(input, existingSecrets, existingBasicAuth));
}

export function buildStoredPrivateRepoConfig(
	input: Omit<PrivateRepoConfigInput, 'exposedPorts'>,
	existingSecrets: RuntimeConfig['secrets'],
	existingBasicAuth?: BasicAuthConfig
): PrivateRepoServiceConfig {
	return normalizePrivateRepoConfig(withResolvedSensitive(input, existingSecrets, existingBasicAuth));
}

// repoUrl isn't client-supplied for github-repo — it's derived from repoFullName so the stored clone URL is always canonical.
export function buildStoredGithubRepoConfig(
	input: Omit<GithubRepoConfigInput, 'exposedPorts'>,
	existingSecrets: RuntimeConfig['secrets'],
	existingBasicAuth?: BasicAuthConfig
): GithubRepoServiceConfig {
	const repoFullName = input.repoFullName.trim();
	const repoUrl = `https://github.com/${repoFullName}.git`;
	return normalizeGithubRepoConfig({
		...withResolvedSensitive(input, existingSecrets, existingBasicAuth),
		repoUrl
	} as unknown as GithubRepoServiceConfig);
}

function normalizeDatabaseConfig(
	engine: DatabaseEngine,
	input: Omit<DatabaseUpdateConfigInput, 'exposedPorts'>,
	password: string,
	existingSecrets: RuntimeConfig['secrets']
): DatabaseServiceConfig {
	const resources = normalizeResources(input.resources);
	const secrets = resolveSecrets(input.secrets, existingSecrets);
	const database = input.database?.trim();
	const username = input.username?.trim();

	return {
		containerPort: DATABASE_ENGINE_CATALOG[engine].port,
		env: (input.env ?? []).filter(item => item?.key != null && item?.value != null).map(item => ({ key: item.key.trim(), value: item.value.trim() })),
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
	input: Omit<DatabaseUpdateConfigInput, 'exposedPorts'>,
	existing: { secrets: RuntimeConfig['secrets']; password: string } | null
): DatabaseServiceConfig {
	const password = existing?.password ?? encryptSecret(generatePassword());
	return normalizeDatabaseConfig(engine, input, password, existing?.secrets);
}
