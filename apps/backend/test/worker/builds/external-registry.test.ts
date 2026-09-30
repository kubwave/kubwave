import { afterEach, expect, mock, test } from 'bun:test';
mock.module('~/shared/config/worker-env', () => ({ env: { registryInsecure: false } }));
mock.module('~/modules/worker/jobs/registry/auth', () => ({ registryAuthHeaders: async () => ({ Authorization: 'Basic test' }) }));
const { verifiedImageRef, promoteBuildCache } = await import('~/shared/builds/registry');
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

test('uses the verified digest for the runtime image and forwards registry credentials', async () => {
	globalThis.fetch = (async (url, init) => {
		expect(String(url)).toBe('https://registry.test/v2/service/manifests/attempt-1');
		expect(init?.method).toBe('HEAD');
		expect(new Headers(init?.headers).get('Authorization')).toBe('Basic test');
		return new Response(null, { headers: { 'docker-content-digest': `sha256:${'a'.repeat(64)}` } });
	}) as typeof fetch;
	expect(await verifiedImageRef('registry.test/service:attempt-1')).toBe(`registry.test/service@sha256:${'a'.repeat(64)}`);
});

test('rejects success without a valid registry digest', async () => {
	globalThis.fetch = (async () => new Response(null, { headers: { 'docker-content-digest': 'invalid' } })) as unknown as typeof fetch;
	expect(await verifiedImageRef('registry.test/service:attempt-1')).toBeNull();
});

test('promotes only the accepted attempt cache to the stable cache tag', async () => {
	const calls: Array<{ url: string; method: string; body: unknown }> = [];
	globalThis.fetch = (async (url, init) => {
		calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body });
		return new Response('{"schemaVersion":2}', { headers: { 'content-type': 'application/vnd.oci.image.index.v1+json' } });
	}) as typeof fetch;
	await promoteBuildCache('registry.test/service:cache-attempt', 'registry.test/service:buildcache');
	expect(calls).toEqual([
		{ url: 'https://registry.test/v2/service/manifests/cache-attempt', method: 'GET', body: undefined },
		{ url: 'https://registry.test/v2/service/manifests/buildcache', method: 'PUT', body: '{"schemaVersion":2}' }
	]);
});
