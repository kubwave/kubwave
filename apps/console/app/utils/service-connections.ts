import type { Service } from './types';

const SERVICE_REFERENCE_ENV_KEY_RE = /(^|_)(HOST|HOSTNAME|ADDR|ADDRESS|URL|URI|DSN|ENDPOINT|SERVER)$/i;

export interface ServiceConnection {
	id: string;
	sourceServiceId: string;
	targetServiceId: string;
	envKeys: string[];
}

interface ServiceConnectionInput {
	id: string;
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

function appendEnvKey(connection: ServiceConnection, key: string): void {
	if (!connection.envKeys.includes(key)) connection.envKeys.push(key);
}

export function deriveServiceConnections(services: ServiceConnectionInput[]): ServiceConnection[] {
	const targets = services.filter((service): service is ServiceConnectionInput & { internalDomain: string } => Boolean(service.internalDomain));
	const byPair = new Map<string, ServiceConnection>();

	for (const source of services) {
		for (const env of source.config.env) {
			if (!isServiceReferenceEnvKey(env.key)) continue;

			for (const target of targets) {
				if (target.id === source.id) continue;
				if (!referencesInternalDomain(env.value, target.internalDomain)) continue;

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
