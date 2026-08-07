import type { RegistryAuthConfig } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { normalizeRegistryServer } from '@kubwave/kube';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';

// Registry v2 manifest HEAD + bearer-challenge auth, shared by the tag watcher. Returns the digest or null when the tag doesn't exist (404); other failures throw.

const MANIFEST_ACCEPT =
	'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json';

// Docker Hub serves the API from registry-1.docker.io even though refs and dockerconfigjson entries use docker.io/index.docker.io.
const DOCKER_HUB_API_HOST = 'registry-1.docker.io';

export interface ParsedImageRef {
	host: string;
	repo: string;
	tag: string;
}

export interface RegistryCredentials {
	username: string;
	password: string;
}

// Split "registry/image" + tag into API host and repo. A bare name (or a slash path whose first segment has no dot/colon) is Docker Hub; bare names get the `library/` prefix.
export function parseImageRef(image: string, tag: string): ParsedImageRef {
	const trimmed = image.trim();
	const firstSlash = trimmed.indexOf('/');
	const firstSegment = firstSlash < 0 ? '' : trimmed.slice(0, firstSlash);
	const isHostSegment = firstSlash >= 0 && (firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost');

	let host: string;
	let repo: string;
	if (!isHostSegment) {
		host = DOCKER_HUB_API_HOST;
		repo = trimmed;
	} else {
		host = firstSegment;
		repo = trimmed.slice(firstSlash + 1);
	}

	if (host === 'docker.io' || host === 'index.docker.io' || host === 'registry.hub.docker.com' || host === DOCKER_HUB_API_HOST) {
		host = DOCKER_HUB_API_HOST;
		// A bare name lives under the library namespace; namespaced refs (acme/web) keep their namespace.
		if (!repo.includes('/')) repo = `library/${repo}`;
	}

	return { host, repo, tag: tag.trim() };
}

// HTTP for dev registries (k3d, localhost) and the platform build registry when REGISTRY_INSECURE; https everywhere else.
function schemeFor(host: string): string {
	const lower = host.toLowerCase();
	// Strip ports on both sides: the endpoint is configured as host:port but an image ref may carry a different (or no) port.
	if (env.registryInsecure && lower.split(':')[0] === env.registryEndpoint.split(':')[0]) {
		return 'http';
	}
	if (
		lower === 'localhost' ||
		lower.startsWith('localhost:') ||
		lower.startsWith('127.0.0.1') ||
		lower.includes('.k3d.') ||
		lower.startsWith('k3d-')
	) {
		return 'http';
	}
	return 'https';
}

// Only send the service's stored credentials when their server matches the image's registry host (Docker Hub variants included).
function credentialsFor(host: string, registryAuth: RegistryAuthConfig | undefined): RegistryCredentials | undefined {
	if (!registryAuth) return undefined;
	const server = normalizeRegistryServer(registryAuth.server)
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/v\d+\/?$/, '');
	const matches =
		server === host.toLowerCase() ||
		(server === 'index.docker.io' && host === DOCKER_HUB_API_HOST) ||
		(server === 'docker.io' && host === DOCKER_HUB_API_HOST);
	if (!matches) return undefined;
	return { username: registryAuth.username, password: decryptSecret(registryAuth.password) };
}

// Token endpoints allowed to serve a Bearer challenge for a registry even though they live on another hostname.
const TRUSTED_TOKEN_HOSTS: Record<string, string[]> = {
	[DOCKER_HUB_API_HOST]: ['auth.docker.io'],
	'index.docker.io': ['auth.docker.io'],
	'docker.io': ['auth.docker.io'],
	'registry.gitlab.com': ['gitlab.com']
};

// Perform the request, then if the registry challenges with a Bearer realm (Docker Hub, GHCR, ...), exchange credentials for a token and retry once.
async function fetchWithRegistryAuth(url: string, repo: string, credentials: RegistryCredentials | undefined, init: RequestInit): Promise<Response> {
	const baseHeaders: Record<string, string> = { ...(init.headers as Record<string, string>) };
	if (credentials) {
		baseHeaders.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
	}
	const res = await fetch(url, { ...init, headers: baseHeaders });
	if (res.status !== 401) return res;

	const challenge = res.headers.get('www-authenticate');
	const realm = /realm="([^"]+)"/.exec(challenge ?? '')?.[1];
	if (!realm) return res;

	// The realm receives our Basic credentials when we exchange them, so it must be the registry itself (or a trusted auth host) —
	// otherwise a compromised registry could redirect the credentials anywhere. Never downgrade to plain http on an https registry.
	const registryUrl = new URL(url);
	const realmUrl = new URL(realm);
	const trustedHosts = TRUSTED_TOKEN_HOSTS[registryUrl.hostname] ?? [];
	if (realmUrl.hostname !== registryUrl.hostname && !trustedHosts.includes(realmUrl.hostname)) {
		throw new Error(`registry token realm host mismatch: ${realmUrl.hostname} not trusted for ${registryUrl.hostname}`);
	}
	if (registryUrl.protocol === 'https:' && realmUrl.protocol !== 'https:') {
		throw new Error('registry token realm must use https when the registry does');
	}

	const service = /service="([^"]+)"/.exec(challenge ?? '')?.[1];
	const scope = /scope="([^"]+)"/.exec(challenge ?? '')?.[1] ?? `repository:${repo}:pull`;
	const tokenUrl = `${realm}?service=${encodeURIComponent(service ?? '')}&scope=${encodeURIComponent(scope)}`;

	const tokenRes = await fetch(tokenUrl, { headers: baseHeaders, signal: init.signal });
	if (!tokenRes.ok) return tokenRes;
	const body = (await tokenRes.json()) as { token?: string; access_token?: string };
	const token = body.token ?? body.access_token;
	if (!token) return tokenRes;

	return fetch(url, { ...init, headers: { ...baseHeaders, Authorization: `Bearer ${token}` } });
}

// Current digest for an image tag. Null only when the tag does not exist (yet); auth/network failures throw so the watcher can back off.
export async function resolveTagDigest(
	ref: ParsedImageRef,
	registryAuth: RegistryAuthConfig | undefined,
	timeoutMs: number = env.registryTagWatchTimeoutMs
): Promise<string | null> {
	const url = `${schemeFor(ref.host)}://${ref.host}/v2/${ref.repo}/manifests/${ref.tag}`;
	try {
		const res = await fetchWithRegistryAuth(url, ref.repo, credentialsFor(ref.host, registryAuth), {
			method: 'HEAD',
			headers: { Accept: MANIFEST_ACCEPT },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (res.status === 404) return null;
		if (!res.ok) {
			throw new Error(`registry ${ref.host}: HTTP ${res.status} resolving ${ref.repo}:${ref.tag}`);
		}
		const digest = res.headers.get('docker-content-digest');
		if (!digest) throw new Error(`registry ${ref.host}: no docker-content-digest for ${ref.repo}:${ref.tag}`);
		return digest;
	} catch (err) {
		throw new Error(`failed to resolve ${ref.host}/${ref.repo}:${ref.tag}: ${errorMessage(err)}`);
	}
}
