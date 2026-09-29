import type { UpdateServiceDto } from '@kubwave/api-client';
import type { Service } from '@/lib/api/types';
import { watchPathConfigFields } from '@/lib/repo-watch-paths';
import { isDatabaseEngine } from '@/lib/service-types';
import type { ServiceSettingsValues } from './values';

type Config = Record<string, unknown>;

const REPO_TYPES = new Set(['public-repo', 'private-repo', 'github-repo', 'gitea-repo']);
const lines = (value: string) =>
	value
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);
// Only keys with a value: the API treats absent optional fields as "unset".
const optionalNumber = (key: string, value: string) => (value.trim() ? { [key]: Number(value) } : {});
const optionalText = (key: string, value: string) => (value.trim() ? { [key]: value.trim() } : {});

function healthCheck({ healthCheck: hc }: ServiceSettingsValues): Config {
	if (!hc.enabled) return { enabled: false, type: 'http' };
	return {
		enabled: true,
		type: hc.type,
		...(hc.type === 'http' ? { path: hc.path.trim() } : {}),
		...optionalNumber('port', hc.port),
		...optionalNumber('initialDelaySeconds', hc.initialDelaySeconds),
		...optionalNumber('periodSeconds', hc.periodSeconds),
		...optionalNumber('timeoutSeconds', hc.timeoutSeconds),
		...optionalNumber('failureThreshold', hc.failureThreshold),
		...optionalNumber('successThreshold', hc.successThreshold)
	};
}

function resources({ resources: r }: ServiceSettingsValues): Config {
	const set = {
		...optionalText('cpuRequest', r.cpuRequest),
		...optionalText('cpuLimit', r.cpuLimit),
		...optionalText('memoryRequest', r.memoryRequest),
		...optionalText('memoryLimit', r.memoryLimit)
	};
	return Object.keys(set).length > 0 ? { resources: set } : {};
}

function autoscaling({ autoscaling: a }: ServiceSettingsValues): Config {
	if (!a.enabled) return { enabled: false };
	return {
		enabled: true,
		...optionalNumber('minReplicas', a.minReplicas),
		...optionalNumber('maxReplicas', a.maxReplicas),
		...optionalNumber('targetCpuUtilizationPercentage', a.targetCpuUtilizationPercentage),
		...optionalNumber('targetMemoryUtilizationPercentage', a.targetMemoryUtilizationPercentage)
	};
}

// An empty password keeps the stored one (null), matching the API's keep-existing semantics.
function basicAuth({ basicAuth: auth }: ServiceSettingsValues): Config {
	if (!auth.enabled) return { enabled: false };
	const publicPaths = lines(auth.publicPaths);
	return { enabled: true, username: auth.username.trim(), password: auth.password || null, ...(publicPaths.length > 0 ? { publicPaths } : {}) };
}

function variables(values: ServiceSettingsValues) {
	return {
		env: values.env.map(entry => ({ key: entry.key.trim(), value: entry.value })).filter(entry => entry.key),
		secrets: values.secrets
			.filter(secret => secret.key.trim())
			.map(secret => ({ key: secret.key.trim(), value: secret.hasValue && secret.value === '' ? null : secret.value })),
		exposedPorts: values.exposedPorts
			.filter(exposure => exposure.containerPort.trim())
			.map(exposure => ({ containerPort: Number(exposure.containerPort) }))
	};
}

function runtime(values: ServiceSettingsValues): Config {
	const port = values.containerPort.trim();
	return {
		containerPort: port ? Number(port) : null,
		defaultDomainEnabled: values.defaultDomainEnabled && Boolean(port),
		...variables(values),
		domains: values.domains.filter(domain => domain.host.trim()).map(domain => ({ host: domain.host.trim(), port: Number(domain.port) })),
		volumes: values.volumes
			.filter(volume => volume.name.trim())
			.map(volume => ({
				name: volume.name.trim(),
				mountPath: volume.mountPath.trim(),
				size: volume.size.trim(),
				...optionalText('subPath', volume.subPath)
			})),
		healthCheck: healthCheck(values),
		...resources(values),
		autoscaling: autoscaling(values),
		basicAuth: basicAuth(values)
	};
}

function repoBuild(values: ServiceSettingsValues): Config {
	const nixpacks = values.builder !== 'dockerfile';
	return {
		branch: values.branch.trim(),
		builder: values.builder,
		...(nixpacks ? {} : optionalText('dockerfilePath', values.dockerfilePath)),
		...optionalText('commit', values.commit),
		...optionalText('rootDirectory', values.rootDirectory),
		...watchPathConfigFields(values.watchPaths, values.watchEntireRepo),
		...(nixpacks ? optionalText('buildCommand', values.buildCommand) : {}),
		...(nixpacks ? optionalText('startCommand', values.startCommand) : {})
	};
}

// Database name and user are immutable after creation and pass through unchanged.
function databaseConfig(service: Service, values: ServiceSettingsValues): Config {
	const current = service.config as unknown as Config;
	const { env, secrets, exposedPorts } = variables(values);
	return {
		version: values.version.trim(),
		storage: { size: values.storage.trim() || '1Gi' },
		...(typeof current.database === 'string' && current.database ? { database: current.database } : {}),
		...(typeof current.username === 'string' && current.username ? { username: current.username } : {}),
		env,
		secrets,
		exposedPorts,
		...resources(values)
	};
}

function imageConfig(values: ServiceSettingsValues): Config {
	const auth = values.registryAuth;
	return {
		image: values.image,
		tag: values.tag,
		...runtime(values),
		configFiles: values.configFiles.filter(file => file.path.trim()).map(file => ({ path: file.path.trim(), content: file.content })),
		command: values.command.map(token => token.value.trim()).filter(Boolean),
		args: values.args.map(token => token.value.trim()).filter(Boolean),
		registryAuth: auth.enabled
			? { enabled: true, server: auth.server.trim(), username: auth.username.trim(), password: auth.password || null }
			: { enabled: false }
	};
}

function buildConfig(service: Service, values: ServiceSettingsValues): Config {
	const { type } = service;
	if (isDatabaseEngine(type)) return databaseConfig(service, values);
	if (type === 'dockerfile') return { dockerfile: values.dockerfile.trim(), ...runtime(values) };
	if (type === 'public-repo') return { repoUrl: values.repoUrl.trim(), ...repoBuild(values), ...runtime(values) };
	if (type === 'private-repo') return { repoUrl: values.repoUrl.trim(), sshKeyId: values.sshKeyId.trim(), ...repoBuild(values), ...runtime(values) };
	if (type === 'github-repo' || type === 'gitea-repo')
		return { installationId: values.installationId.trim(), repoFullName: values.repoFullName.trim(), ...repoBuild(values), ...runtime(values) };
	return imageConfig(values);
}

// The PATCH body for a service from its edited settings. Auto-deploy applies to repo services,
// image watch to docker-image services.
export function buildServiceUpdate(service: Service, values: ServiceSettingsValues): UpdateServiceDto & { config: Config } {
	return {
		name: values.name.trim(),
		description: values.description,
		config: buildConfig(service, values),
		...(REPO_TYPES.has(service.type) ? { autoDeploy: { enabled: values.autoDeploy.enabled } } : {}),
		...(service.type === 'docker-image' ? { imageWatch: { enabled: values.imageWatch.enabled } } : {})
	};
}
