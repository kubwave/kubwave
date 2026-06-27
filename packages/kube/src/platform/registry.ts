import { createHash } from 'node:crypto';

export const BUILD_REGISTRY_SETTINGS_KEY = 'build-registry';
export const REGISTRY_HTPASSWD_SECRET_NAME = 'registry-htpasswd';
export const REGISTRY_PUSH_SECRET_NAME = 'registry-creds';
export const REGISTRY_PULL_SECRET_NAME = 'kubwave-registry-pull';

export type BuildRegistrySettings =
	| { mode: 'unconfigured' }
	| { mode: 'platform' }
	| { mode: 'external'; endpoint: string; insecure: boolean; username: string; passwordCiphertext?: string };

export interface BuildRegistryEndpoint {
	endpoint: string;
	host: string;
	port?: number;
}

export const DEFAULT_BUILD_REGISTRY_SETTINGS: BuildRegistrySettings = { mode: 'unconfigured' };

export function platformRegistryHost(domain: string): string {
	return `registry.${domain}`;
}

export function parseBuildRegistryEndpoint(raw: string): BuildRegistryEndpoint {
	const trimmed = raw.trim();
	if (!trimmed) throw new Error('External registry endpoint is required');
	if (trimmed.includes('://')) {
		throw new Error('External registry endpoint must not include a URL scheme; use host or host/org');
	}
	if (/\s/.test(trimmed)) throw new Error('External registry endpoint must not contain whitespace');
	if (trimmed.startsWith('/')) throw new Error('External registry endpoint must start with a registry host');

	const endpoint = trimmed.replace(/\/+$/, '');
	const parts = endpoint.split('/');
	if (parts.some(part => part.length === 0)) throw new Error('External registry endpoint must not contain empty path segments');

	const host = parts[0];
	if (!host) throw new Error('External registry endpoint must start with a registry host');
	if (host.includes('@')) throw new Error('External registry endpoint must not include credentials');

	const port = explicitPort(host);
	return { endpoint, host, ...(port !== undefined ? { port } : {}) };
}

export function buildRegistryEndpointHost(endpoint: string): string {
	return parseBuildRegistryEndpoint(endpoint).host;
}

export function buildRegistryNetworkPolicyEgressPorts(endpoint: string): number[] | undefined {
	const port = parseBuildRegistryEndpoint(endpoint).port;
	if (port === undefined || port === 80 || port === 443) return undefined;
	return [80, 443, port];
}

export function normalizeBuildRegistrySettings(value: unknown): BuildRegistrySettings {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_BUILD_REGISTRY_SETTINGS;
	const v = value as Partial<BuildRegistrySettings>;
	if (v.mode === 'platform') return { mode: 'platform' };
	if (v.mode === 'external') {
		let endpoint = '';
		try {
			endpoint = typeof v.endpoint === 'string' ? parseBuildRegistryEndpoint(v.endpoint).endpoint : '';
		} catch {
			return DEFAULT_BUILD_REGISTRY_SETTINGS;
		}
		const username = typeof v.username === 'string' ? v.username : '';
		const passwordCiphertext = typeof v.passwordCiphertext === 'string' && v.passwordCiphertext ? v.passwordCiphertext : undefined;
		if (!endpoint || !username) return DEFAULT_BUILD_REGISTRY_SETTINGS;
		return {
			mode: 'external',
			endpoint,
			insecure: v.insecure === true,
			username,
			...(passwordCiphertext ? { passwordCiphertext } : {})
		};
	}
	return DEFAULT_BUILD_REGISTRY_SETTINGS;
}

export function buildRegistryConfigured(settings: BuildRegistrySettings): boolean {
	return settings.mode !== 'unconfigured';
}

export function buildRegistryCredentialHash(settings: Extract<BuildRegistrySettings, { mode: 'external' }>): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				endpoint: settings.endpoint,
				insecure: settings.insecure,
				username: settings.username,
				password: settings.passwordCiphertext ?? ''
			})
		)
		.digest('hex')
		.slice(0, 16);
}

function explicitPort(host: string): number | undefined {
	if (host.startsWith('[')) {
		const match = /^\[[^\]]+\](?::(\d+))?$/.exec(host);
		if (!match) throw new Error('External registry endpoint has an invalid IPv6 host');
		return parsePort(match[1]);
	}

	const colonCount = (host.match(/:/g) ?? []).length;
	if (colonCount === 0) return undefined;
	if (colonCount > 1) throw new Error('External registry endpoint IPv6 hosts must use [addr]:port syntax');

	return parsePort(host.slice(host.lastIndexOf(':') + 1));
}

function parsePort(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined;
	if (!/^\d+$/.test(raw)) throw new Error('External registry endpoint port must be numeric');
	const port = Number(raw);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('External registry endpoint port must be between 1 and 65535');
	return port;
}
