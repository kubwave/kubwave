import { parseDocument } from 'yaml';
import { ComposeParseError } from './compose.errors.js';
import type { ParsedComposeService } from './compose.types.js';

const SERVICE_NAME_MAX = 100;
const IMAGE_MAX = 255;
const TAG_MAX = 128;
const ENV_KEY_MAX = 128;
const ENV_VALUE_MAX = 4000;
const ENV_MAX = 100;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VOLUME_MAX = 10;
const MOUNT_PATH_MAX = 512;
const VOLUME_NAME_MAX = 63;
const DEFAULT_VOLUME_SIZE = '1Gi';
const HOST_PATH_CLEAN_RE = /[^a-z0-9-]/g;
const DEFAULT_IMAGE_TAG = 'latest';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseYaml(compose: string): unknown {
	let doc: ReturnType<typeof parseDocument>;
	try {
		doc = parseDocument(compose);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new ComposeParseError([`Compose YAML is invalid: ${message}`]);
	}

	if (doc.errors.length > 0) {
		throw new ComposeParseError(doc.errors.map(error => `Compose YAML is invalid: ${error.message}`));
	}

	return doc.toJS();
}

function parseImageRef(value: unknown, path: string, issues: string[]): { image: string; tag: string } | null {
	if (typeof value !== 'string') {
		issues.push(`${path}.image must be a string.`);
		return null;
	}

	const ref = value.trim();
	if (!ref) {
		issues.push(`${path}.image must not be empty.`);
		return null;
	}

	const lastSlash = ref.lastIndexOf('/');
	const lastColon = ref.lastIndexOf(':');
	const hasTag = lastColon > lastSlash;

	const image = (hasTag ? ref.slice(0, lastColon) : ref).trim();
	const tag = hasTag ? ref.slice(lastColon + 1).trim() : DEFAULT_IMAGE_TAG;
	if (!image || !tag) {
		issues.push(`${path}.image tag must not be empty.`);
		return null;
	}
	if (image.length > IMAGE_MAX) issues.push(`${path}.image is too long.`);
	if (tag.length > TAG_MAX) issues.push(`${path}.image tag is too long.`);
	return { image, tag };
}

function valueToEnvString(value: unknown, path: string, issues: string[]): string | null {
	if (Array.isArray(value) || isRecord(value)) {
		issues.push(`${path} must be a scalar value.`);
		return null;
	}
	return value == null ? '' : String(value);
}

function pushEnv(env: Array<{ key: string; value: string }>, keyValue: { key: string; value: string }, path: string, issues: string[]): void {
	const key = keyValue.key.trim();
	if (!key) {
		issues.push(`${path} has an empty environment variable name.`);
		return;
	}
	if (key.length > ENV_KEY_MAX || !ENV_KEY_RE.test(key)) {
		issues.push(`${path}.${key} must be a valid environment variable name.`);
		return;
	}
	if (keyValue.value.length > ENV_VALUE_MAX) {
		issues.push(`${path}.${key} value is too long.`);
		return;
	}
	env.push({ key, value: keyValue.value });
}

function parseEnvironment(value: unknown, path: string, issues: string[]): Array<{ key: string; value: string }> {
	if (value === undefined) return [];
	const env: Array<{ key: string; value: string }> = [];

	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			if (typeof item !== 'string') {
				issues.push(`${path}.environment[${index}] must be KEY=value or KEY.`);
				continue;
			}
			const eq = item.indexOf('=');
			const key = eq === -1 ? item : item.slice(0, eq);
			const envValue = eq === -1 ? '' : item.slice(eq + 1);
			pushEnv(env, { key, value: envValue }, `${path}.environment[${index}]`, issues);
		}
	} else if (isRecord(value)) {
		for (const [key, rawValue] of Object.entries(value)) {
			const envValue = valueToEnvString(rawValue, `${path}.environment.${key}`, issues);
			if (envValue !== null) pushEnv(env, { key, value: envValue }, `${path}.environment`, issues);
		}
	} else {
		issues.push(`${path}.environment must be an object or an array.`);
	}

	if (env.length > ENV_MAX) issues.push(`${path}.environment must contain at most ${ENV_MAX} variables.`);
	return env;
}

function parsePortNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
	if (typeof value !== 'string') return null;

	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return null;

	const port = Number(trimmed);
	return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function parsePortEntry(entry: unknown): number | null {
	if (typeof entry === 'number') return parsePortNumber(entry);

	if (typeof entry === 'string') {
		const [portPart, protocol = 'tcp'] = entry.split('/');
		if (protocol.toLowerCase() !== 'tcp') return null;
		const target = (portPart ?? '').split(':').pop() ?? '';
		return parsePortNumber(target);
	}

	if (isRecord(entry)) {
		const protocol = typeof entry.protocol === 'string' ? entry.protocol.toLowerCase() : 'tcp';
		if (protocol !== 'tcp') return null;
		return parsePortNumber(entry.target);
	}

	return null;
}

function parseFirstPort(value: unknown, path: string, issues: string[]): number | null {
	if (value === undefined) return null;

	const entries = Array.isArray(value) ? value : [value];
	if (entries.some(entry => Array.isArray(entry))) {
		issues.push(`${path} must be a list of port strings, numbers, or objects.`);
		return null;
	}

	for (const entry of entries) {
		const port = parsePortEntry(entry);
		if (port !== null) return port;
	}

	return null;
}

function parsePortConfig(service: Record<string, unknown>, path: string, issues: string[]): Pick<ParsedComposeService['config'], 'containerPort'> {
	const publicPort = parseFirstPort(service.ports, `${path}.ports`, issues);
	if (publicPort !== null) return { containerPort: publicPort };

	const internalPort = parseFirstPort(service.expose, `${path}.expose`, issues);
	return { containerPort: internalPort };
}

function deriveVolumeName(hostPath: string | null, index: number): string {
	if (!hostPath) return `volume-${index}`;
	const segments = hostPath.split('/').filter(Boolean);
	const last = segments[segments.length - 1] ?? 'volume';
	const clean = last.replace(/^\.+/, '').replace(HOST_PATH_CLEAN_RE, '-').toLowerCase();
	return clean || `volume-${index}`;
}

function parseVolumeEntry(entry: unknown, path: string, issues: string[]): { hostPath: string | null; mountPath: string } | null {
	if (typeof entry === 'string') {
		const trimmed = entry.trim();
		if (!trimmed) {
			issues.push(`${path} has an empty volume entry.`);
			return null;
		}

		const colon = trimmed.indexOf(':');
		if (colon === -1) {
			if (!trimmed.startsWith('/')) {
				issues.push(`${path} must be a valid volume path.`);
				return null;
			}
			return { hostPath: null, mountPath: trimmed };
		}

		const hostPath = trimmed.slice(0, colon).trim() || null;
		const mountPath = trimmed.slice(colon + 1).trim();
		if (!mountPath) {
			issues.push(`${path} has an empty container path.`);
			return null;
		}
		if (!mountPath.startsWith('/')) {
			issues.push(`${path} container path must be absolute.`);
			return null;
		}
		return { hostPath, mountPath };
	}

	if (isRecord(entry)) {
		const source = typeof entry.source === 'string' ? entry.source : null;
		const target = typeof entry.target === 'string' ? entry.target : null;
		if (!target) {
			issues.push(`${path} must have a target (container path).`);
			return null;
		}
		return { hostPath: source, mountPath: target };
	}

	issues.push(`${path} must be a string or an object.`);
	return null;
}

function parseVolumes(value: unknown, path: string, issues: string[]): Array<{ name: string; mountPath: string; size: string }> {
	if (value === undefined) return [];

	if (!Array.isArray(value)) {
		issues.push(`${path} must be an array.`);
		return [];
	}

	const volumes: Array<{ name: string; mountPath: string; size: string }> = [];

	for (const [index, entry] of value.entries()) {
		const entryPath = `${path}[${index}]`;
		const parsed = parseVolumeEntry(entry, entryPath, issues);
		if (!parsed) continue;

		const mountPath = parsed.mountPath;
		if (!mountPath.startsWith('/') || mountPath.length > MOUNT_PATH_MAX) {
			issues.push(`${entryPath} has an invalid container path.`);
			continue;
		}

		const name = deriveVolumeName(parsed.hostPath, index);
		if (!name || name.length > VOLUME_NAME_MAX) {
			issues.push(`${entryPath} derived volume name is invalid.`);
			continue;
		}

		volumes.push({ name, mountPath, size: DEFAULT_VOLUME_SIZE });
	}

	if (volumes.length > VOLUME_MAX) issues.push(`${path} must contain at most ${VOLUME_MAX} volumes.`);
	return volumes;
}

export function parseComposeServices(compose: string): ParsedComposeService[] {
	const root = parseYaml(compose);
	if (!isRecord(root)) throw new ComposeParseError(['Compose file must be a YAML object.']);
	if (!isRecord(root.services)) throw new ComposeParseError(['Compose file must contain a services object.']);

	const issues: string[] = [];
	const parsed: ParsedComposeService[] = [];
	const seenNames = new Set<string>();

	for (const [rawName, rawService] of Object.entries(root.services)) {
		const path = `services.${rawName}`;
		const serviceIssues: string[] = [];
		const name = rawName.trim();

		if (!name) serviceIssues.push(`${path} has an empty service name.`);
		if (name.length > SERVICE_NAME_MAX) serviceIssues.push(`${path} service name is too long.`);
		if (seenNames.has(name)) serviceIssues.push(`Duplicate service name "${name}" in Compose file.`);
		seenNames.add(name);

		if (!isRecord(rawService)) {
			serviceIssues.push(`${path} must be an object.`);
			issues.push(...serviceIssues);
			continue;
		}

		const imageRef = parseImageRef(rawService.image, path, serviceIssues);
		const env = parseEnvironment(rawService.environment, path, serviceIssues);
		const portConfig = parsePortConfig(rawService, path, serviceIssues);
		const volumes = parseVolumes(rawService.volumes, `${path}.volumes`, serviceIssues);

		if (serviceIssues.length === 0 && imageRef) {
			parsed.push({
				name,
				config: {
					image: imageRef.image,
					tag: imageRef.tag,
					...portConfig,
					env,
					domains: [],
					volumes
				}
			});
		}

		issues.push(...serviceIssues);
	}

	if (issues.length > 0) throw new ComposeParseError(issues);
	if (parsed.length === 0) throw new ComposeParseError(['Compose file must contain at least one service.']);
	return parsed;
}
