import { describe, expect, mock, test } from 'bun:test';

// version/job.ts is poller wiring: a 6h POLL_INTERVAL_MS + runVersionPoll() delegating to
// checkForUpdates(). Mock ./check so the wrapper is tested in isolation.

let checkCalls = 0;
let checkResult: { success: boolean; message: string } = { success: true, message: 'ok' };

mock.module('~/modules/worker/jobs/version/check', () => ({
	checkForUpdates: async () => {
		checkCalls++;
		return checkResult;
	}
}));

const { runVersionPoll, POLL_INTERVAL_MS } = await import('~/modules/worker/jobs/version/job');

describe('POLL_INTERVAL_MS', () => {
	test('is six hours in milliseconds', () => {
		expect(POLL_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
		expect(POLL_INTERVAL_MS).toBe(21_600_000);
	});
});

describe('runVersionPoll', () => {
	test('invokes checkForUpdates exactly once and resolves void', async () => {
		checkCalls = 0;
		const result = await runVersionPoll();
		expect(checkCalls).toBe(1);
		expect(result).toBeUndefined();
	});

	test('swallows the checkForUpdates result (poll resolves even on a failed check)', async () => {
		checkCalls = 0;
		checkResult = { success: false, message: 'boom' };
		await expect(runVersionPoll()).resolves.toBeUndefined();
		expect(checkCalls).toBe(1);
	});
});
