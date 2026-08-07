import { afterEach, describe, expect, mock, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '@kubwave/crypto';

process.env.SECRETS_KEY = randomBytes(32).toString('base64url');

mock.module('~/shared/config/worker-env', () => ({
	env: {
		registryInsecure: false,
		registryEndpoint: '',
		registryTagWatchTimeoutMs: 5000
	}
}));

const { parseImageRef, resolveTagDigest } = await import('~/modules/worker/jobs/registry-tag-watch/registry');

const DOCKER_HUB_API_HOST = 'registry-1.docker.io';

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('parseImageRef', () => {
	test('bare names are Docker Hub library images', () => {
		expect(parseImageRef('nginx', 'next')).toEqual({ host: DOCKER_HUB_API_HOST, repo: 'library/nginx', tag: 'next' });
	});

	test('docker.io prefixed refs normalize to the API host', () => {
		expect(parseImageRef('docker.io/nginx', 'latest')).toEqual({ host: DOCKER_HUB_API_HOST, repo: 'library/nginx', tag: 'latest' });
		expect(parseImageRef('index.docker.io/acme/web', '1.0')).toEqual({ host: DOCKER_HUB_API_HOST, repo: 'acme/web', tag: '1.0' });
	});

	test('hostless namespace refs (Docker Hub user images) map to the API host', () => {
		expect(parseImageRef('acme/web', 'next')).toEqual({ host: DOCKER_HUB_API_HOST, repo: 'acme/web', tag: 'next' });
	});

	test('hosted refs keep their host and repo', () => {
		expect(parseImageRef('ghcr.io/acme/web', 'next')).toEqual({ host: 'ghcr.io', repo: 'acme/web', tag: 'next' });
	});

	test('host:port refs keep the port', () => {
		expect(parseImageRef('k3d-kubwave-registry:5000/env-1/web', 'dep-1')).toEqual({
			host: 'k3d-kubwave-registry:5000',
			repo: 'env-1/web',
			tag: 'dep-1'
		});
	});
});

describe('resolveTagDigest', () => {
	test('returns the docker-content-digest header on a clean HEAD', async () => {
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			expect(init?.method ?? '').toBe('HEAD');
			const headers = init?.headers as Record<string, string> | undefined;
			expect(headers?.Accept).toContain('application/vnd.docker.distribution.manifest.v2+json');
			expect(headers?.Authorization).toBeUndefined();
			return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:abc' } });
		}) as typeof fetch;

		expect(await resolveTagDigest(parseImageRef('ghcr.io/acme/web', 'next'), undefined)).toBe('sha256:abc');
	});

	test('returns null when the tag does not exist (404)', async () => {
		globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
		expect(await resolveTagDigest(parseImageRef('ghcr.io/acme/web', 'missing'), undefined)).toBeNull();
	});

	test('exchanges credentials for a bearer token on a 401 challenge, then resolves', async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const headers = (init?.headers ?? {}) as Record<string, string>;
			calls.push(url);
			if (url.endsWith('/v2/acme/web/manifests/next') && headers.Authorization?.startsWith('Basic ')) {
				return new Response(null, {
					status: 401,
					headers: {
						'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:acme/web:pull"'
					}
				});
			}
			if (url.startsWith('https://ghcr.io/token')) {
				expect(headers.Authorization?.startsWith('Basic ')).toBe(true);
				return new Response(JSON.stringify({ token: 'TOKEN-1' }), { status: 200 });
			}
			if (url.endsWith('/v2/acme/web/manifests/next') && headers.Authorization === 'Bearer TOKEN-1') {
				return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:xyz' } });
			}
			throw new Error(`unexpected call: ${url}`);
		}) as typeof fetch;

		const creds = { server: 'ghcr.io', username: 'octocat', password: encryptSecret('s3cret') };
		const digest = await resolveTagDigest(parseImageRef('ghcr.io/acme/web', 'next'), creds);
		expect(digest).toBe('sha256:xyz');
		expect(calls.some(url => url.startsWith('https://ghcr.io/token'))).toBe(true);
	});

	test('rejects a token realm on a foreign host (no credentials leak)', async () => {
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			const headers = (init?.headers ?? {}) as Record<string, string>;
			if (headers.Authorization?.startsWith('Basic ')) {
				return new Response(null, {
					status: 401,
					headers: { 'www-authenticate': 'Bearer realm="https://evil.example.com/token",service="ghcr.io"' }
				});
			}
			throw new Error(`unexpected call: ${String(_input)}`);
		}) as typeof fetch;

		const creds = { server: 'ghcr.io', username: 'octocat', password: encryptSecret('s3cret') };
		await expect(resolveTagDigest(parseImageRef('ghcr.io/acme/web', 'next'), creds)).rejects.toThrow(/token realm host mismatch/);
	});

	test('rejects a plain-http token realm for an https registry', async () => {
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			const headers = (init?.headers ?? {}) as Record<string, string>;
			if (headers.Authorization?.startsWith('Basic ')) {
				return new Response(null, {
					status: 401,
					headers: { 'www-authenticate': 'Bearer realm="http://ghcr.io/token",service="ghcr.io"' }
				});
			}
			throw new Error(`unexpected call: ${String(_input)}`);
		}) as typeof fetch;

		const creds = { server: 'ghcr.io', username: 'octocat', password: encryptSecret('s3cret') };
		await expect(resolveTagDigest(parseImageRef('ghcr.io/acme/web', 'next'), creds)).rejects.toThrow(/realm must use https/);
	});

	test('trusts the auth.docker.io token realm for Docker Hub', async () => {
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const headers = (init?.headers ?? {}) as Record<string, string>;
			if (url.endsWith('/v2/library/nginx/manifests/latest') && !headers.Authorization) {
				return new Response(null, {
					status: 401,
					headers: {
						'www-authenticate': 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"'
					}
				});
			}
			if (url.startsWith('https://auth.docker.io/token')) {
				return new Response(JSON.stringify({ token: 'HUB-TOKEN' }), { status: 200 });
			}
			if (url.endsWith('/v2/library/nginx/manifests/latest') && headers.Authorization === 'Bearer HUB-TOKEN') {
				return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:hub' } });
			}
			throw new Error(`unexpected call: ${url}`);
		}) as typeof fetch;

		expect(await resolveTagDigest(parseImageRef('nginx', 'latest'), undefined)).toBe('sha256:hub');
	});

	test('does not send credentials when the stored server does not match the image host', async () => {
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			const headers = (init?.headers ?? {}) as Record<string, string>;
			expect(headers.Authorization).toBeUndefined();
			return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:abc' } });
		}) as typeof fetch;

		const creds = { server: 'ghcr.io', username: 'u', password: encryptSecret('p') };
		expect(await resolveTagDigest(parseImageRef('docker.io/nginx', 'latest'), creds)).toBe('sha256:abc');
	});

	test('throws when the registry rejects (non-401, non-404)', async () => {
		globalThis.fetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
		await expect(resolveTagDigest(parseImageRef('ghcr.io/acme/web', 'next'), undefined)).rejects.toThrow();
	});

	test('throws on network failure', async () => {
		globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
			throw new Error('ECONNREFUSED');
		}) as unknown as typeof fetch;
		await expect(resolveTagDigest(parseImageRef('ghcr.io/acme/web', 'next'), undefined)).rejects.toThrow(/ECONNREFUSED/);
	});

	test('uses http for the platform registry when insecure', async () => {
		mock.module('~/shared/config/worker-env', () => ({
			env: { registryInsecure: true, registryEndpoint: 'host.k3d.internal:5111', registryTagWatchTimeoutMs: 5000 }
		}));
		const { resolveTagDigest: resolveInsecure } = await import('~/modules/worker/jobs/registry-tag-watch/registry');
		let url = '';
		globalThis.fetch = (async (input: string | URL | Request) => {
			url = String(input);
			return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:abc' } });
		}) as typeof fetch;
		await resolveInsecure(parseImageRef('host.k3d.internal:5111/env-1/web', 'dep-1'), undefined);
		expect(url).toBe('http://host.k3d.internal:5111/v2/env-1/web/manifests/dep-1');
	});

	test('matches an insecure platform registry only when host and port agree', async () => {
		mock.module('~/shared/config/worker-env', () => ({
			env: { registryInsecure: true, registryEndpoint: 'registry.example.com:5111', registryTagWatchTimeoutMs: 5000 }
		}));
		const { resolveTagDigest: resolveInsecure } = await import('~/modules/worker/jobs/registry-tag-watch/registry');
		let url = '';
		globalThis.fetch = (async (input: string | URL | Request) => {
			url = String(input);
			return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:abc' } });
		}) as typeof fetch;
		// Same host and port as the endpoint → insecure http.
		await resolveInsecure(parseImageRef('registry.example.com:5111/env-1/web', 'dep-1'), undefined);
		expect(url).toBe('http://registry.example.com:5111/v2/env-1/web/manifests/dep-1');
		// Same host, different port → a different service; must stay https, not downgrade.
		await resolveInsecure(parseImageRef('registry.example.com:443/env-1/web', 'dep-1'), undefined);
		expect(url).toBe('https://registry.example.com:443/v2/env-1/web/manifests/dep-1');
		// Portless ref against a ported endpoint → default port, not the insecure registry; stays https.
		await resolveInsecure(parseImageRef('registry.example.com/env-1/web', 'dep-1'), undefined);
		expect(url).toBe('https://registry.example.com/v2/env-1/web/manifests/dep-1');
	});
});
