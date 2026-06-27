import { afterEach, describe, expect, mock, test } from 'bun:test';

// runGitPoll is one sweep tick: claim a batch of due services (bounded by gitPollBatch), then
// poll them concurrently. Assert the batch size passes through and every claimed service polls.

let claimed: Array<{ id: string }> = [];
let claimedLimit: number | null = null;
const polled: string[] = [];

mock.module('~/shared/config/worker-env', () => ({ env: { gitPollBatch: 20 } }));
mock.module('~/modules/worker/jobs/git-poll/claim', () => ({
	claimDueServices: async (_now: Date, limit: number) => {
		claimedLimit = limit;
		return claimed;
	}
}));
mock.module('~/modules/worker/jobs/git-poll/poll', () => ({
	pollService: async (service: { id: string }) => {
		polled.push(service.id);
	}
}));

const { runGitPoll } = await import('~/modules/worker/jobs/git-poll/job');

afterEach(() => {
	claimed = [];
	claimedLimit = null;
	polled.length = 0;
});

describe('runGitPoll', () => {
	test('claims with the batch limit and polls every claimed service', async () => {
		claimed = [{ id: 'svc-1' }, { id: 'svc-2' }];
		await runGitPoll();
		expect(claimedLimit).toBe(20); // env.gitPollBatch bounds concurrency
		expect(polled.sort()).toEqual(['svc-1', 'svc-2']);
	});

	test('polls nothing when no service is due (early return)', async () => {
		claimed = [];
		await runGitPoll();
		expect(polled).toEqual([]);
	});
});
