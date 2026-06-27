import { afterEach, describe, expect, mock, test } from 'bun:test';

// Mutable env stub so pruneRegistryImages tests can flip registryEndpoint for the early-out.
const fakeEnv = {
	registryEndpoint: 'test-registry:5000',
	registryInsecure: true,
	registryPruneKeep: 2,
	registryPruneIntervalMs: 3_600_000
};
mock.module('~/shared/config/worker-env', () => ({ env: fakeEnv }));

let deploymentRows: Array<Record<string, unknown>> = [];
mock.module('@kubwave/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						orderBy: async () => deploymentRows
					})
				})
			})
		})
	},
	deployments: { id: 'd.id', serviceId: 'd.serviceId', status: 'd.status', type: 'd.type', createdAt: 'd.createdAt' },
	services: { id: 's.id', environmentId: 's.environmentId' }
}));
mock.module('drizzle-orm', () => ({
	desc: (c: unknown) => ({ desc: c }),
	eq: (a: unknown, b: unknown) => ({ eq: [a, b] })
}));

mock.module('~/modules/worker/jobs/registry/auth', () => ({ registryAuthHeaders: async () => ({ Authorization: 'Basic abc' }) }));

const { selectTagsToDelete, computeKeepTags, serviceRepoPath, pruneServiceRepo, pruneRegistryImages } =
	await import('~/modules/worker/jobs/registry/prune');

afterEach(() => {
	fakeEnv.registryEndpoint = 'test-registry:5000';
	fakeEnv.registryPruneKeep = 2;
	deploymentRows = [];
});

describe('serviceRepoPath', () => {
	test('mirrors the Dockerfile build image ref repo', () => {
		expect(serviceRepoPath('env-1', 'svc-9')).toBe('env-env-1/svc-svc-9');
	});
});

describe('selectTagsToDelete', () => {
	test('returns every registry tag not in the keep-set', () => {
		const tags = ['dep-a', 'dep-b', 'dep-c', 'dep-d', 'buildcache'];
		const keep = new Set(['dep-c', 'dep-d']);
		expect(selectTagsToDelete(tags, keep)).toEqual(['dep-a', 'dep-b']);
	});

	test('keeps everything when the registry only holds kept tags', () => {
		expect(selectTagsToDelete(['dep-c'], new Set(['dep-c', 'dep-d']))).toEqual([]);
	});
});

describe('computeKeepTags', () => {
	test('keeps the N most recent succeeded plus all in-flight deployments', () => {
		// newest-first, as the query returns them
		const rows = [
			{ id: 'dep-7', status: 'deploying' }, // in-flight → kept regardless of count
			{ id: 'dep-6', status: 'failed' }, // not kept
			{ id: 'dep-5', status: 'succeeded' }, // running image
			{ id: 'dep-4', status: 'succeeded' }, // rollback target
			{ id: 'dep-3', status: 'succeeded' }, // older → pruned
			{ id: 'dep-2', status: 'superseded' },
			{ id: 'dep-1', status: 'canceling' } // in-flight → kept
		];
		const keep = computeKeepTags(rows, 2);
		expect([...keep].sort()).toEqual(['dep-1', 'dep-4', 'dep-5', 'dep-7']);
	});

	test('keep count of 0 still retains in-flight deployments', () => {
		const rows = [
			{ id: 'dep-2', status: 'succeeded' },
			{ id: 'dep-1', status: 'pending' }
		];
		expect([...computeKeepTags(rows, 0)]).toEqual(['dep-1']);
	});
});

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('pruneServiceRepo', () => {
	test('resolves each non-kept tag to a digest and deletes it', async () => {
		const calls: Array<{ method: string; url: string }> = [];
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			calls.push({ method, url });
			if (url.endsWith('/tags/list')) {
				return new Response(JSON.stringify({ tags: ['keep-me', 'drop-1', 'drop-2'] }), { status: 200 });
			}
			if (method === 'HEAD') {
				// digest derived from the tag so we can assert the DELETE targets it
				const tag = url.split('/manifests/')[1];
				return new Response(null, { status: 200, headers: { 'docker-content-digest': `sha256:${tag}` } });
			}
			if (method === 'DELETE') return new Response(null, { status: 202 });
			return new Response(null, { status: 404 });
		}) as typeof fetch;

		const deleted = await pruneServiceRepo('env-1', 'svc-1', new Set(['keep-me']));

		expect(deleted).toBe(2);
		expect(calls.some(c => c.method === 'HEAD' && c.url.includes('/manifests/keep-me'))).toBe(false);
		expect(calls.some(c => c.method === 'DELETE' && c.url.includes('/manifests/sha256:drop-1'))).toBe(true);
		expect(calls.some(c => c.method === 'DELETE' && c.url.includes('/manifests/sha256:drop-2'))).toBe(true);
	});

	test('skips a tag whose digest cannot be resolved (no delete, no throw)', async () => {
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.endsWith('/tags/list')) return new Response(JSON.stringify({ tags: ['drop-1'] }), { status: 200 });
			if (method === 'HEAD') return new Response(null, { status: 500 }); // digest unresolved
			throw new Error('DELETE should never be reached');
		}) as typeof fetch;

		await expect(pruneServiceRepo('env-1', 'svc-1', new Set())).resolves.toBe(0);
	});

	test('treats a missing repo (404 tags/list) as nothing to prune', async () => {
		globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
		await expect(pruneServiceRepo('env-1', 'svc-1', new Set())).resolves.toBe(0);
	});

	test('a thrown fetch on tags/list (network blip) is swallowed → nothing pruned', async () => {
		// listRepoTags catch path: any throw resolves to [] so the prune is a clean no-op.
		globalThis.fetch = (async () => {
			throw new Error('ECONNRESET');
		}) as unknown as typeof fetch;
		await expect(pruneServiceRepo('env-1', 'svc-1', new Set())).resolves.toBe(0);
	});

	test('a thrown HEAD (digest resolve fails) skips that tag without throwing', async () => {
		// resolveManifestDigest catch path: a throw returns null → the tag is skipped, never deleted.
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith('/tags/list')) return new Response(JSON.stringify({ tags: ['drop-1'] }), { status: 200 });
			if ((init?.method ?? 'GET') === 'HEAD') throw new Error('timeout');
			throw new Error('DELETE should never be reached');
		}) as typeof fetch;
		await expect(pruneServiceRepo('env-1', 'svc-1', new Set())).resolves.toBe(0);
	});

	test('a thrown DELETE (deleteManifest catch) is not counted as deleted', async () => {
		// deleteManifest catch path: a throw returns false, so the tag is not added to the deleted count.
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.endsWith('/tags/list')) return new Response(JSON.stringify({ tags: ['drop-1'] }), { status: 200 });
			if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:abc' } });
			throw new Error('delete network error');
		}) as typeof fetch;
		await expect(pruneServiceRepo('env-1', 'svc-1', new Set())).resolves.toBe(0);
	});

	test('a DELETE that 404s still counts as deleted (already gone)', async () => {
		// deleteManifest treats 404 like 202 — the manifest is gone either way.
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.endsWith('/tags/list')) return new Response(JSON.stringify({ tags: ['drop-1'] }), { status: 200 });
			if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:abc' } });
			return new Response(null, { status: 404 });
		}) as typeof fetch;
		await expect(pruneServiceRepo('env-1', 'svc-1', new Set())).resolves.toBe(1);
	});

	test('a tags/list body with a null tags field yields nothing to prune', async () => {
		// listRepoTags coalesces a missing/null tags field to [].
		globalThis.fetch = (async () => new Response(JSON.stringify({ tags: null }), { status: 200 })) as unknown as typeof fetch;
		await expect(pruneServiceRepo('env-1', 'svc-1', new Set())).resolves.toBe(0);
	});
});

describe('pruneRegistryImages', () => {
	test('no-op (no DB query) when no registry endpoint is configured', async () => {
		fakeEnv.registryEndpoint = '';
		let fetched = false;
		globalThis.fetch = (async () => {
			fetched = true;
			return new Response(null, { status: 404 });
		}) as unknown as typeof fetch;
		await pruneRegistryImages();
		expect(fetched).toBe(false);
	});

	test('groups deployments by service, keeps env.registryPruneKeep succeeded + in-flight, prunes the rest', async () => {
		fakeEnv.registryPruneKeep = 1;
		// Two services; rows arrive newest-first as the query orders them.
		deploymentRows = [
			{ id: 'a-3', serviceId: 'svc-a', environmentId: 'env-a', status: 'succeeded' }, // kept (1 succeeded)
			{ id: 'a-2', serviceId: 'svc-a', environmentId: 'env-a', status: 'succeeded' }, // pruned
			{ id: 'a-1', serviceId: 'svc-a', environmentId: 'env-a', status: 'deploying' }, // in-flight → kept
			{ id: 'b-1', serviceId: 'svc-b', environmentId: 'env-b', status: 'succeeded' } // kept
		];

		const deletes: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			// tags/list returns every deployment id as a tag for the repo it belongs to.
			if (url.endsWith('/env-env-a/svc-svc-a/tags/list')) return new Response(JSON.stringify({ tags: ['a-3', 'a-2', 'a-1'] }), { status: 200 });
			if (url.endsWith('/env-env-b/svc-svc-b/tags/list')) return new Response(JSON.stringify({ tags: ['b-1'] }), { status: 200 });
			if (method === 'HEAD') {
				const tag = url.split('/manifests/')[1];
				return new Response(null, { status: 200, headers: { 'docker-content-digest': `sha256:${tag}` } });
			}
			if (method === 'DELETE') {
				deletes.push(url.split('/manifests/')[1]!);
				return new Response(null, { status: 202 });
			}
			return new Response(null, { status: 404 });
		}) as typeof fetch;

		await pruneRegistryImages();

		// Only svc-a's a-2 is superseded; everything else is kept (succeeded-cap or in-flight).
		expect(deletes).toEqual(['sha256:a-2']);
	});

	test('iterates every service group, pruning each repo independently', async () => {
		// Two services, each with one superseded (non-kept) failed deployment → both repos pruned.
		deploymentRows = [
			{ id: 'a-1', serviceId: 'svc-a', environmentId: 'env-a', status: 'failed' },
			{ id: 'b-1', serviceId: 'svc-b', environmentId: 'env-b', status: 'failed' }
		];

		const deletes: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.endsWith('/env-env-a/svc-svc-a/tags/list')) return new Response(JSON.stringify({ tags: ['a-1'] }), { status: 200 });
			if (url.endsWith('/env-env-b/svc-svc-b/tags/list')) return new Response(JSON.stringify({ tags: ['b-1'] }), { status: 200 });
			if (method === 'HEAD') {
				const tag = url.split('/manifests/')[1];
				return new Response(null, { status: 200, headers: { 'docker-content-digest': `sha256:${tag}` } });
			}
			if (method === 'DELETE') {
				deletes.push(url.split('/manifests/')[1]!);
				return new Response(null, { status: 202 });
			}
			return new Response(null, { status: 404 });
		}) as typeof fetch;

		await pruneRegistryImages();
		expect(deletes.sort()).toEqual(['sha256:a-1', 'sha256:b-1']);
	});

	test('an empty deployment set is a clean no-op', async () => {
		deploymentRows = [];
		globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
		await expect(pruneRegistryImages()).resolves.toBeUndefined();
	});
});

describe('auth header forwarding', () => {
	test('listRepoTags sends Authorization header', async () => {
		let capturedHeaders: RequestInit['headers'];
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			capturedHeaders = init?.headers;
			return new Response(JSON.stringify({ tags: [] }), { status: 200 });
		}) as typeof fetch;
		await pruneServiceRepo('env-1', 'svc-1', new Set());
		expect((capturedHeaders as Record<string, string>)?.Authorization).toBe('Basic abc');
	});

	test('resolveManifestDigest sends Authorization header on HEAD', async () => {
		const calls: Array<{ method: string; headers: RequestInit['headers'] }> = [];
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ method, headers: init?.headers });
			if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:test' } });
			return new Response(JSON.stringify({ tags: ['drop-1'] }), { status: 200 });
		}) as typeof fetch;
		await pruneServiceRepo('env-1', 'svc-1', new Set());
		const headCall = calls.find(c => c.method === 'HEAD');
		expect((headCall?.headers as Record<string, string>)?.Authorization).toBe('Basic abc');
	});

	test('deleteManifest sends Authorization header on DELETE', async () => {
		const calls: Array<{ method: string; headers: RequestInit['headers'] }> = [];
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ method, headers: init?.headers });
			if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'docker-content-digest': 'sha256:test' } });
			if (method === 'DELETE') return new Response(null, { status: 202 });
			return new Response(JSON.stringify({ tags: ['drop-1'] }), { status: 200 });
		}) as typeof fetch;
		await pruneServiceRepo('env-1', 'svc-1', new Set());
		const deleteCall = calls.find(c => c.method === 'DELETE');
		expect((deleteCall?.headers as Record<string, string>)?.Authorization).toBe('Basic abc');
	});
});
