import { afterEach, describe, expect, mock, test } from 'bun:test';

// pollService: ls-remote → (maybe) enqueue → bookkeeping update. Stub the IO edges.

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

let remoteResult: { value: string | null } | { error: string } = { value: SHA_A };
const enqueueCalls: Array<{ id: string; commit: string }> = [];
let lastSet: Record<string, unknown> | null = null;

mock.module('~/shared/config/worker-env', () => ({
	env: { gitLsRemoteTimeoutMs: 20_000, gitPollErrorBackoffSeconds: 300, gitPollBatch: 20, gitPollServiceIntervalSeconds: 60 }
}));
mock.module('~/modules/worker/jobs/git-poll/ls-remote', () => ({
	resolveRemoteHead: async () => {
		if ('error' in remoteResult) throw new Error(remoteResult.error);
		return remoteResult.value;
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

function service(lastPolledCommit: string | null) {
	return {
		id: 'svc-1',
		type: 'public-repo' as const,
		config: { repoUrl: 'https://x/r.git', branch: 'main' } as never,
		lastPolledCommit
	};
}

afterEach(() => {
	enqueueCalls.length = 0;
	lastSet = null;
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
});
