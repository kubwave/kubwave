import type { Service } from '@/lib/api/types';
import { isPrivateRepoSshUrl, privateRepoSshUrlMessage } from '@/lib/private-repo-url';
import { isDatabaseEngine } from '@/lib/service-types';
import type { ServiceSettingsValues } from './values';

// Field path ("healthCheck.path", "volumes.0.size") → first message; empty when valid.
export type SettingsErrors = Record<string, string>;

export const cpuRegex = /^(\d+(\.\d+)?|\d+m)$/;
export const memoryRegex = /^\d+(\.\d+)?[EPTGMK]i?$/;

const QUANTITY_FACTORS: Array<[string, number]> = [
	['Ki', 1024],
	['Mi', 1024 ** 2],
	['Gi', 1024 ** 3],
	['Ti', 1024 ** 4],
	['Pi', 1024 ** 5],
	['Ei', 1024 ** 6],
	['k', 1e3],
	['M', 1e6],
	['G', 1e9],
	['T', 1e12],
	['P', 1e15],
	['E', 1e18]
];

export function parseQuantityToBytes(quantity: string): number | null {
	const value = quantity.trim();
	for (const [suffix, factor] of QUANTITY_FACTORS) {
		if (!value.endsWith(suffix)) continue;
		const amount = Number(value.slice(0, -suffix.length));
		return Number.isFinite(amount) ? amount * factor : null;
	}
	const amount = Number(value);
	return Number.isFinite(amount) ? amount : null;
}

export function isValidPort(value: string): boolean {
	const port = Number(value);
	return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Same patterns as the API DTOs (apps/backend/src/modules/services/services.dto.ts).
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VOLUME_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

const REPO_TYPES = new Set(['public-repo', 'private-repo', 'github-repo', 'gitea-repo']);
const isPositiveInt = (value: string) => /^\d+$/.test(value) && Number(value) >= 1;
// Mirrors the API's 1..100 ceiling so out-of-range values fail inline instead of via a 400.
const isUpTo100 = (value: string) => isPositiveInt(value) && Number(value) <= 100;

class Issues {
	readonly errors: SettingsErrors = {};
	add(path: string, message: string) {
		this.errors[path] ??= message;
	}
}

function checkSource(type: Service['type'], values: ServiceSettingsValues, issues: Issues) {
	if (type === 'dockerfile') {
		if (!values.dockerfile.trim()) issues.add('dockerfile', 'Enter a Dockerfile.');
		else if (!/^\s*FROM\s+\S+/im.test(values.dockerfile)) issues.add('dockerfile', 'A Dockerfile must contain a FROM instruction.');
		return;
	}
	if (isDatabaseEngine(type)) {
		if (!values.version.trim()) issues.add('version', 'Pick a version.');
		// Storage is grow-only; the API enforces that, here only the quantity is checked.
		if (!memoryRegex.test(values.storage.trim())) issues.add('storage', 'Enter a storage size like 1Gi.');
		return;
	}
	if (!REPO_TYPES.has(type)) {
		if (!values.image.trim()) issues.add('image', 'Enter an image.');
		if (!values.tag.trim()) issues.add('tag', 'Enter a tag.');
		return;
	}
	if (type === 'public-repo') {
		if (!values.repoUrl.trim()) issues.add('repoUrl', 'Enter a repository URL.');
		else if (!/^https?:\/\/\S+$/i.test(values.repoUrl.trim())) issues.add('repoUrl', 'Enter a public http(s) Git URL.');
	}
	if (type === 'private-repo') {
		if (!values.repoUrl.trim()) issues.add('repoUrl', 'Enter a repository URL.');
		else if (!isPrivateRepoSshUrl(values.repoUrl)) issues.add('repoUrl', privateRepoSshUrlMessage);
		if (!values.sshKeyId.trim()) issues.add('sshKeyId', 'Select a deploy key.');
	}
	if ((type === 'github-repo' || type === 'gitea-repo') && (!values.installationId.trim() || !values.repoFullName.trim()))
		issues.add('repoFullName', `This service is missing its ${type === 'gitea-repo' ? 'Gitea' : 'GitHub'} repository link.`);
	if (!values.branch.trim()) issues.add('branch', 'Enter a branch.');
	if (values.commit.trim() && !/^[0-9a-fA-F]{7,64}$/.test(values.commit.trim())) issues.add('commit', 'Enter a valid commit SHA.');
}

function checkPublicPath(raw: string, issues: Issues) {
	const path = raw.trim();
	if (!path) return;
	// Judge the derived path: "//*" strips to "/" and would make every route public.
	const target = path.endsWith('/*') ? path.slice(0, -2) : path;
	const key = 'basicAuth.publicPaths';
	if (!path.startsWith('/')) issues.add(key, 'Each public path must start with "/".');
	else if (path.split('/').includes('..')) issues.add(key, 'Public paths cannot contain "..".');
	else if (!/^\/[^*]*(\/\*)?$/.test(path))
		issues.add(key, 'Use absolute paths like /health or /api/* (a wildcard is only allowed at the end as "/*").');
	else if (target === '/' || target === '') issues.add(key, '"/" makes every route public — disable basic auth instead.');
}

function checkNetworking(values: ServiceSettingsValues, issues: Issues) {
	if (values.containerPort.trim() && !isValidPort(values.containerPort.trim())) issues.add('containerPort', 'Use a port between 1 and 65535.');
	const { basicAuth, registryAuth, healthCheck } = values;
	if (basicAuth.enabled) {
		if (!basicAuth.username.trim()) issues.add('basicAuth.username', 'A username is required when basic auth is enabled.');
		if (!basicAuth.hasPassword && !basicAuth.password) issues.add('basicAuth.password', 'A password is required when basic auth is enabled.');
		basicAuth.publicPaths.split('\n').forEach(path => checkPublicPath(path, issues));
	}
	if (registryAuth.enabled) {
		if (!registryAuth.server.trim()) issues.add('registryAuth.server', 'A registry server is required when registry auth is enabled.');
		if (!registryAuth.username.trim()) issues.add('registryAuth.username', 'A username is required when registry auth is enabled.');
		if (!registryAuth.hasPassword && !registryAuth.password)
			issues.add('registryAuth.password', 'A password is required when registry auth is enabled.');
	}
	values.domains.forEach((domain, index) => {
		if (domain.host.trim() && !isValidPort(domain.port.trim())) issues.add(`domains.${index}.port`, 'Use a port between 1 and 65535.');
	});
	const seen = new Set<string>();
	values.exposedPorts.forEach((exposure, index) => {
		const port = exposure.containerPort.trim();
		if (!isValidPort(port)) issues.add(`exposedPorts.${index}.containerPort`, 'Use a port between 1 and 65535.');
		else if (seen.has(port)) issues.add(`exposedPorts.${index}.containerPort`, 'Each exposed port must be different.');
		seen.add(port);
	});
	if (healthCheck.enabled && healthCheck.type === 'http' && !healthCheck.path.trim())
		issues.add('healthCheck.path', 'Path is required for HTTP health checks.');
}

function checkFiles(values: ServiceSettingsValues, issues: Issues) {
	const seen = new Set<string>();
	values.configFiles.forEach((file, index) => {
		const path = file.path.trim();
		if (!path) return;
		const key = `configFiles.${index}.path`;
		if (!path.startsWith('/')) issues.add(key, 'Use an absolute path like /etc/kong.yml.');
		else if (path.split('/').includes('..')) issues.add(key, 'Path cannot contain "..".');
		else if (seen.has(path)) issues.add(key, 'Each config file must have a unique path.');
		seen.add(path);
	});
	// Headroom under the 1 MiB Kubernetes Secret the rendered files must fit into.
	const bytes = values.configFiles.reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0);
	if (bytes > 900 * 1024) issues.add('configFiles', 'Config files exceed the total size limit (about 900 KB).');
}

// A Map, not an object: volume names are user input and must not hit prototype keys ("constructor").
function checkScaling(values: ServiceSettingsValues, originalVolumeSizes: ReadonlyMap<string, string>, issues: Issues) {
	const { resources, autoscaling: as } = values;
	for (const key of ['cpuRequest', 'cpuLimit'] as const)
		if (resources[key].trim() && !cpuRegex.test(resources[key].trim())) issues.add(`resources.${key}`, 'Use a CPU quantity like 250m or 1.');
	for (const key of ['memoryRequest', 'memoryLimit'] as const)
		if (resources[key].trim() && !memoryRegex.test(resources[key].trim())) issues.add(`resources.${key}`, 'Use a memory quantity like 256Mi or 1Gi.');

	values.volumes.forEach((volume, index) => {
		const original = originalVolumeSizes.get(volume.name.trim());
		const before = original ? parseQuantityToBytes(original) : null;
		const after = parseQuantityToBytes(volume.size);
		if (before !== null && after !== null && after < before) issues.add(`volumes.${index}.size`, `Volumes can only grow (was ${original}).`);
	});

	if (!as.enabled) return;
	// A volume is ReadWriteOnce and pins the service to one instance.
	if (values.volumes.length > 0)
		issues.add('autoscaling.enabled', 'Disable autoscaling to use a volume — a volume pins the service to one instance.');
	const [min, max, cpu, memory] = [
		as.minReplicas.trim(),
		as.maxReplicas.trim(),
		as.targetCpuUtilizationPercentage.trim(),
		as.targetMemoryUtilizationPercentage.trim()
	];
	if (min && !isUpTo100(min)) issues.add('autoscaling.minReplicas', 'Enter a whole number between 1 and 100.');
	if (!isUpTo100(max)) issues.add('autoscaling.maxReplicas', 'Set a maximum between 1 and 100.');
	else if (min && isUpTo100(min) && Number(min) > Number(max)) issues.add('autoscaling.minReplicas', 'Min must be ≤ max.');
	if (cpu && !isUpTo100(cpu)) issues.add('autoscaling.targetCpuUtilizationPercentage', 'Enter a percentage between 1 and 100.');
	if (memory && !isUpTo100(memory)) issues.add('autoscaling.targetMemoryUtilizationPercentage', 'Enter a percentage between 1 and 100.');
	if (!cpu && !memory) issues.add('autoscaling.targetCpuUtilizationPercentage', 'Set at least one target (CPU or memory).');
	// The HPA needs the matching request to compute a utilisation percentage.
	if (cpu && !resources.cpuRequest.trim()) issues.add('autoscaling.targetCpuUtilizationPercentage', 'Set a CPU request above to target CPU.');
	if (memory && !resources.memoryRequest.trim())
		issues.add('autoscaling.targetMemoryUtilizationPercentage', 'Set a memory request above to target memory.');
}

// Rows the payload keeps (a filled-in key, name or host) must pass the API's format rules.
function checkNames(values: ServiceSettingsValues, issues: Issues) {
	const keyMessage = 'Use letters, digits and underscores; start with a letter or underscore.';
	values.env.forEach((entry, index) => {
		if (entry.key.trim() && !ENV_KEY_RE.test(entry.key.trim())) issues.add(`env.${index}.key`, keyMessage);
	});
	values.secrets.forEach((secret, index) => {
		if (secret.key.trim() && !ENV_KEY_RE.test(secret.key.trim())) issues.add(`secrets.${index}.key`, keyMessage);
	});
	values.volumes.forEach((volume, index) => {
		if (!volume.name.trim()) return;
		if (!VOLUME_NAME_RE.test(volume.name.trim())) issues.add(`volumes.${index}.name`, 'Use lowercase letters, digits and dashes.');
		if (!volume.mountPath.trim().startsWith('/')) issues.add(`volumes.${index}.mountPath`, 'Use an absolute path like /data.');
		if (!memoryRegex.test(volume.size.trim())) issues.add(`volumes.${index}.size`, 'Use a size like 1Gi or 500Mi.');
		if (volume.subPath.trim().startsWith('/')) issues.add(`volumes.${index}.subPath`, 'Use a relative path without a leading slash.');
	});
	values.domains.forEach((domain, index) => {
		if (domain.host.trim() && !HOSTNAME_RE.test(domain.host.trim())) issues.add(`domains.${index}.host`, 'Enter a valid hostname.');
	});
}

export function settingsErrors(service: Service, values: ServiceSettingsValues): SettingsErrors {
	const issues = new Issues();
	if (!values.name.trim()) issues.add('name', 'Enter a name.');
	checkSource(service.type, values, issues);
	checkNames(values, issues);
	checkNetworking(values, issues);
	checkFiles(values, issues);
	checkScaling(values, new Map((service.config.volumes ?? []).map(volume => [volume.name, volume.size])), issues);
	return issues.errors;
}
