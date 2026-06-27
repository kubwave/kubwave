import { describe, expect, it, mock } from 'bun:test';
import { createIntervalJob } from '~/shared/scheduler/interval-job';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(r => {
		resolve = r;
	});
	return { promise, resolve };
}
const fakeHandle = 1 as unknown as ReturnType<typeof setInterval>;

describe('createIntervalJob', () => {
	it('single-flight: skips a tick while the previous is still running', async () => {
		let captured: (() => void) | null = null;
		const setIntervalFn = mock((fn: () => void) => {
			captured = fn;
			return fakeHandle;
		});
		const gate = deferred();
		let calls = 0;
		createIntervalJob({
			name: 'test',
			intervalMs: 1000,
			task: async () => {
				calls++;
				await gate.promise;
			},
			setIntervalFn,
			clearIntervalFn: () => {}
		});
		captured!();
		captured!();
		await Promise.resolve();
		expect(calls).toBe(1);
		gate.resolve();
	});

	it('runImmediately: runs exactly once at creation', () => {
		let calls = 0;
		createIntervalJob({
			name: 'test',
			intervalMs: 1000,
			runImmediately: true,
			task: async () => {
				calls++;
			},
			setIntervalFn: () => fakeHandle,
			clearIntervalFn: () => {}
		});
		expect(calls).toBe(1);
	});

	it('disabled: starts no timer and stop() is a no-op', () => {
		const setIntervalFn = mock(() => fakeHandle);
		const job = createIntervalJob({
			name: 'test',
			intervalMs: 1000,
			enabled: false,
			task: async () => {},
			setIntervalFn,
			clearIntervalFn: () => {}
		});
		expect(setIntervalFn).not.toHaveBeenCalled();
		expect(() => job.stop()).not.toThrow();
	});

	it('catches a throwing task so the tick does not reject and the job keeps running', async () => {
		let captured: (() => void) | null = null;
		const setIntervalFn = mock((fn: () => void) => {
			captured = fn;
			return fakeHandle;
		});
		let calls = 0;
		createIntervalJob({
			name: 'test',
			intervalMs: 1000,
			task: async () => {
				calls++;
				throw new Error('tick boom');
			},
			setIntervalFn,
			clearIntervalFn: () => {}
		});
		// A throwing tick is swallowed (console.warn) and the running flag is cleared in finally, so
		// the next tick still runs rather than being permanently blocked.
		captured!();
		await Promise.resolve();
		captured!();
		await Promise.resolve();
		expect(calls).toBe(2);
	});

	it('stop(): clears the interval once and is idempotent on repeat calls', () => {
		const clearIntervalFn = mock(() => {});
		const job = createIntervalJob({
			name: 'test',
			intervalMs: 1000,
			task: async () => {},
			setIntervalFn: () => fakeHandle,
			clearIntervalFn
		});
		job.stop();
		job.stop(); // second call hits the `if (stopped) return` guard
		expect(clearIntervalFn).toHaveBeenCalledTimes(1);
		expect(clearIntervalFn).toHaveBeenCalledWith(fakeHandle);
	});
});
