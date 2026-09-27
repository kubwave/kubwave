import type { Service } from './types';

const SERVICE_REFERENCE_ENV_KEY_RE = /(^|_)(HOST|HOSTNAME|ADDR|ADDRESS|URL|URI|DSN|ENDPOINT|SERVER)$/i;
// `${{services.<name>.<prop>}}`; names may contain dots, so the name is everything up to the last one.
const SERVICE_NAME_REFERENCE_RE = /\$\{\{\s*services\.(.+?)\.[^.\s}]+\s*\}\}/g;

export interface ServiceConnection {
	id: string;
	sourceServiceId: string;
	targetServiceId: string;
	envKeys: string[];
}

interface ServiceConnectionInput {
	id: string;
	name: string;
	internalDomain: string | null;
	config: Pick<Service['config'], 'env'>;
}

export function isServiceReferenceEnvKey(key: string): boolean {
	return SERVICE_REFERENCE_ENV_KEY_RE.test(key);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referencesInternalDomain(value: string, internalDomain: string): boolean {
	const escaped = escapeRegExp(internalDomain.trim());
	if (!escaped) return false;
	const domainRef = new RegExp(`(^|[^A-Za-z0-9-])${escaped}($|[^A-Za-z0-9-])`);
	return domainRef.test(value);
}

function referencesServiceName(value: string, name: string): boolean {
	return [...value.matchAll(SERVICE_NAME_REFERENCE_RE)].some(match => match[1] === name);
}

function appendEnvKey(connection: ServiceConnection, key: string): void {
	if (!connection.envKeys.includes(key)) connection.envKeys.push(key);
}

export function deriveServiceConnections(services: ServiceConnectionInput[]): ServiceConnection[] {
	const targets = services.filter((service): service is ServiceConnectionInput & { internalDomain: string } => Boolean(service.internalDomain));
	const byPair = new Map<string, ServiceConnection>();

	for (const source of services) {
		for (const env of source.config.env) {
			const hostLikeKey = isServiceReferenceEnvKey(env.key);

			for (const target of targets) {
				if (target.id === source.id) continue;
				const byHost = hostLikeKey && referencesInternalDomain(env.value, target.internalDomain);
				if (!byHost && !referencesServiceName(env.value, target.name)) continue;

				const id = `service-connection:${source.id}:${target.id}`;
				const connection = byPair.get(id);
				if (connection) {
					appendEnvKey(connection, env.key);
					continue;
				}

				byPair.set(id, {
					id,
					sourceServiceId: source.id,
					targetServiceId: target.id,
					envKeys: [env.key]
				});
			}
		}
	}

	return [...byPair.values()];
}
