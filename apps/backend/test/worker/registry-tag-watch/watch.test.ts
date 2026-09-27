import { afterEach, describe, expect, mock, test } from 'bun:test';

// watchService: resolve tag digest → (maybe) enqueue pinned deployment → bookkeeping update. Stub the IO edges.

const DIGEST_A = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DIGEST_B = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

let digestResult: { value: string | null } | { error: string } = { value: DIGEST_A };
const enqueueCalls: Array<{ id: string; digest: string }> = [];
let lastSet: Record<string, unknown> | null = null;

mock.module('~/shared/config/worker-env', () => ({
	env: {
		registryTagWatchTimeoutMs: 5000,
		registryTagWatchErrorBackoffSeconds: 300,
		registryTagWatchServiceIntervalSeconds: 120,
		registryTagWatchBatch: 20
	}
}));
mock.module('~/modules/worker/jobs/registry-tag-watch/registry', () => ({
	parseImageRef: (image: string, tag: string) => ({ host: 'ghcr.io', repo: image, tag }),
	resolveTagDigest: async () => {
		if ('error' in digestResult) throw new Error(digestResult.error);
		return digestResult.value;
	}
}));
mock.module('~/modules/worker/jobs/registry-tag-watch/enqueue', () => ({
	enqueueWatchDeployment: async (service: { id: string }, digest: string) => {
		enqueueCalls.push({ id: service.id, digest });
	}
}));
// db.update(services).set(values).where(cond) — capture the values written.
mock.module('@kubwave/db', () => ({
	services: {},
	db: {
		update: () => ({
			set: (values: Record<string, unknown>) => {
				lastSet = values;
				return { where: async () => undefined };
			}
		})
	}
}));

const { watchService } = await import('~/modules/worker/jobs/registry-tag-watch/watch');

function service(lastWatchedDigest: string | null) {
	return {
		id: 'svc-1',
		type: 'docker-image' as const,
		config: { image: 'acme/web', tag: 'next', containerPort: null, env: [], domains: [], volumes: [] } as never,
		lastWatchedDigest
	};
}

afterEach(() => {
	enqueueCalls.length = 0;
	lastSet = null;
});

describe('watchService', () => {
	const now = new Date('2026-06-14T12:00:00.000Z');

	test('enqueues a pinned deployment and records the digest when the tag moved', async () => {
		digestResult = { value: DIGEST_B };
		await watchService(service(DIGEST_A), now);
		expect(enqueueCalls).toEqual([{ id: 'svc-1', digest: DIGEST_B }]);
		expect(lastSet).toEqual({ lastWatchedDigest: DIGEST_B, lastWatchError: null });
	});

	test('enqueues on the first watch (no baseline digest)', async () => {
		digestResult = { value: DIGEST_A };
		await watchService(service(null), now);
		expect(enqueueCalls).toEqual([{ id: 'svc-1', digest: DIGEST_A }]);
		expect(lastSet).toEqual({ lastWatchedDigest: DIGEST_A, lastWatchError: null });
	});

	test('does not enqueue when the digest is unchanged, but clears any prior error', async () => {
		digestResult = { value: DIGEST_A };
		await watchService(service(DIGEST_A), now);
		expect(enqueueCalls).toEqual([]);
		expect(lastSet).toEqual({ lastWatchedDigest: DIGEST_A, lastWatchError: null });
	});

	test('a missing tag (404 → null) is silent: nothing enqueued, prior digest kept, error cleared', async () => {
		digestResult = { value: null };
		await watchService(service(DIGEST_A), now);
		expect(enqueueCalls).toEqual([]);
		expect(lastSet).toEqual({ lastWatchedDigest: DIGEST_A, lastWatchError: null });
	});

	test('records the error and backs off when the registry check fails', async () => {
		digestResult = { error: 'failed to resolve ghcr.io/acme/web:next: ECONNREFUSED' };
		await watchService(service(DIGEST_A), now);
		expect(enqueueCalls).toEqual([]);
		expect(lastSet).not.toBeNull();
		const set = lastSet as Record<string, unknown>;
		expect(set.lastWatchError).toContain('ECONNREFUSED');
		expect(set.nextPollAt).toBeUndefined();
		expect(set.nextWatchAt).toBeInstanceOf(Date);
		// Backoff schedules at least the 300s error window ahead.
		expect((set.nextWatchAt as Date).getTime()).toBeGreaterThanOrEqual(now.getTime() + 240_000);
	});
});
