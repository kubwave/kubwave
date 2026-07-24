import { afterEach, describe, expect, mock, test } from 'bun:test';

// pollService: ls-remote → (maybe) path filter → enqueue → bookkeeping update. Stub the IO edges.

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

let remoteResult: { value: string | null } | { error: string } = { value: SHA_A };
let changedPathsResult: { files: string[] } | { error: string } | null = null;
const enqueueCalls: Array<{ id: string; commit: string }> = [];
let lastSet: Record<string, unknown> | null = null;

mock.module('~/shared/config/worker-env', () => ({
	env: {
		gitLsRemoteTimeoutMs: 20_000,
		gitDiffTimeoutMs: 30_000,
		gitPollErrorBackoffSeconds: 300,
		gitPollBatch: 20,
		gitPollServiceIntervalSeconds: 60
	}
}));
mock.module('~/modules/worker/jobs/git-poll/ls-remote', () => ({
	resolveRemoteHead: async () => {
		if ('error' in remoteResult) throw new Error(remoteResult.error);
		return remoteResult.value;
	}
}));
mock.module('~/modules/worker/jobs/git-poll/changed-paths', () => ({
	listChangedPaths: async () => {
		if (!changedPathsResult) throw new Error('listChangedPaths called unexpectedly');
		if ('error' in changedPathsResult) throw new Error(changedPathsResult.error);
		return changedPathsResult.files;
	}
}));
mock.module('~/modules/worker/jobs/git-poll/enqueue', () => ({
	enqueueAutoDeployment: async (service: { id: string }, commit: string) => {
		enqueueCalls.push({ id: service.id, commit });
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

const { pollService } = await import('~/modules/worker/jobs/git-poll/poll');

function service(lastPolledCommit: string | null, config: Record<string, unknown> = {}) {
	return {
		id: 'svc-1',
		type: 'public-repo' as const,
		config: { repoUrl: 'https://x/r.git', branch: 'main', ...config } as never,
		lastPolledCommit
	};
}

afterEach(() => {
	enqueueCalls.length = 0;
	lastSet = null;
	changedPathsResult = null;
});

describe('pollService', () => {
	const now = new Date('2026-06-14T12:00:00.000Z');

	test('enqueues and records the SHA when the branch HEAD advanced', async () => {
		remoteResult = { value: SHA_B };
		await pollService(service(SHA_A), now);
		expect(enqueueCalls).toEqual([{ id: 'svc-1', commit: SHA_B }]);
		expect(lastSet).toEqual({ lastPolledCommit: SHA_B, lastPollError: null });
	});

	test('does not enqueue when the HEAD is unchanged, but clears any prior error', async () => {
		remoteResult = { value: SHA_A };
		await pollService(service(SHA_A), now);
		expect(enqueueCalls).toEqual([]);
		expect(lastSet).toEqual({ lastPolledCommit: SHA_A, lastPollError: null });
	});

	test('records the error and backs off (does not enqueue) when ls-remote fails', async () => {
		remoteResult = { error: 'git ls-remote failed: auth' };
		await pollService(service(SHA_A), now);
		expect(enqueueCalls).toEqual([]);
		expect(lastSet).not.toBeNull();
		const set = lastSet as Record<string, unknown>;
		expect(set.lastPollError).toBe('git ls-remote failed: auth');
		expect(set.nextPollAt).toBeInstanceOf(Date);
		// Backoff schedules at least the 300s error window ahead.
		expect((set.nextPollAt as Date).getTime()).toBeGreaterThanOrEqual(now.getTime() + 240_000);
	});

	test('first poll with rootDirectory still enqueues (no baseline to diff)', async () => {
		remoteResult = { value: SHA_A };
		await pollService(service(null, { rootDirectory: 'apps/web' }), now);
		expect(enqueueCalls).toEqual([{ id: 'svc-1', commit: SHA_A }]);
		expect(lastSet).toEqual({ lastPolledCommit: SHA_A, lastPollError: null });
	});

	test('skips enqueue when changed files miss watch paths, but still records the SHA', async () => {
		remoteResult = { value: SHA_B };
		changedPathsResult = { files: ['README.md', 'apps/api/index.ts'] };
		await pollService(service(SHA_A, { rootDirectory: 'apps/web' }), now);
		expect(enqueueCalls).toEqual([]);
		expect(lastSet).toEqual({ lastPolledCommit: SHA_B, lastPollError: null });
	});

	test('enqueues when a changed file matches rootDirectory', async () => {
		remoteResult = { value: SHA_B };
		changedPathsResult = { files: ['apps/web/page.vue', 'README.md'] };
		await pollService(service(SHA_A, { rootDirectory: 'apps/web' }), now);
		expect(enqueueCalls).toEqual([{ id: 'svc-1', commit: SHA_B }]);
	});

	test('enqueues when a changed file matches an additional watch path', async () => {
		remoteResult = { value: SHA_B };
		changedPathsResult = { files: ['packages/db/src/schema.ts'] };
		await pollService(service(SHA_A, { rootDirectory: 'apps/web', watchPaths: ['packages/db'] }), now);
		expect(enqueueCalls).toEqual([{ id: 'svc-1', commit: SHA_B }]);
	});

	test('enqueues on path-filter failure (fail-open)', async () => {
		remoteResult = { value: SHA_B };
		changedPathsResult = { error: 'git fetch failed' };
		await pollService(service(SHA_A, { rootDirectory: 'apps/web' }), now);
		expect(enqueueCalls).toEqual([{ id: 'svc-1', commit: SHA_B }]);
	});

	test('watchEntireRepo skips the path filter', async () => {
		remoteResult = { value: SHA_B };
		await pollService(service(SHA_A, { rootDirectory: 'apps/web', watchEntireRepo: true }), now);
		expect(enqueueCalls).toEqual([{ id: 'svc-1', commit: SHA_B }]);
	});
});
