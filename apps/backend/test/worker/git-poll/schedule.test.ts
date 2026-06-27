import { describe, expect, mock, test } from 'bun:test';

// ls-remote.ts imports the db client (throws at import without DATABASE_URL) + crypto; stub both
// so the pure parseLsRemote can be imported in isolation.
mock.module('@kubwave/db', () => ({ db: {}, sshKeys: {} }));
mock.module('@kubwave/crypto', () => ({ decryptSecret: (s: string) => s }));

const { computeBackoffAt, computeNextPollAt, shouldDeploy } = await import('~/modules/worker/jobs/git-poll/schedule');
const { parseLsRemote } = await import('~/modules/worker/jobs/git-poll/ls-remote');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('shouldDeploy', () => {
	test('deploys when the remote HEAD differs from the last triggered SHA', () => {
		expect(shouldDeploy(SHA_B, SHA_A)).toBe(true);
	});
	test('skips when the remote HEAD is unchanged', () => {
		expect(shouldDeploy(SHA_A, SHA_A)).toBe(false);
	});
	test('deploys on the very first poll (no prior SHA)', () => {
		expect(shouldDeploy(SHA_A, null)).toBe(true);
	});
	test('never deploys when the branch resolved to nothing', () => {
		expect(shouldDeploy(null, SHA_A)).toBe(false);
		expect(shouldDeploy(undefined, null)).toBe(false);
	});
});

describe('computeNextPollAt', () => {
	const now = new Date('2026-06-14T12:00:00.000Z');

	test('schedules ~interval ahead, centered (rng=0.5 → no jitter offset)', () => {
		const next = computeNextPollAt(now, 60, 0.2, () => 0.5);
		expect(next.getTime() - now.getTime()).toBe(60_000);
	});

	test('applies negative jitter at the low end (rng=0)', () => {
		const next = computeNextPollAt(now, 100, 0.2, () => 0);
		// factor = 1 + (0*2-1)*0.2 = 0.8 → 80s
		expect(next.getTime() - now.getTime()).toBe(80_000);
	});

	test('stays within ±jitter of the interval across the rng range', () => {
		for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
			const deltaMs = computeNextPollAt(now, 60, 0.2, () => r).getTime() - now.getTime();
			expect(deltaMs).toBeGreaterThanOrEqual(48_000); // 60 * 0.8
			expect(deltaMs).toBeLessThanOrEqual(72_000); // 60 * 1.2
		}
	});

	test('clamps a zero/negative interval to a minimum so it always advances', () => {
		expect(computeNextPollAt(now, 0, 0.2, () => 0.5).getTime()).toBeGreaterThan(now.getTime());
	});
});

describe('computeBackoffAt', () => {
	const now = new Date('2026-06-14T12:00:00.000Z');

	test('backs off to the larger of interval and backoff window', () => {
		const next = computeBackoffAt(now, 60, 300, () => 0.5);
		expect(next.getTime() - now.getTime()).toBe(300_000);
	});

	test('never schedules sooner than the normal interval', () => {
		const next = computeBackoffAt(now, 600, 300, () => 0.5);
		expect(next.getTime() - now.getTime()).toBe(600_000);
	});
});

describe('parseLsRemote', () => {
	test('extracts the SHA for the exact branch ref', () => {
		const out = `${SHA_A}\trefs/heads/main\n${SHA_B}\trefs/heads/dev\n`;
		expect(parseLsRemote(out, 'main')).toBe(SHA_A);
		expect(parseLsRemote(out, 'dev')).toBe(SHA_B);
	});

	test('returns null when the branch is absent (deleted/renamed)', () => {
		expect(parseLsRemote(`${SHA_A}\trefs/heads/main\n`, 'release')).toBeNull();
	});

	test('returns null for empty output', () => {
		expect(parseLsRemote('', 'main')).toBeNull();
	});

	test('lowercases and ignores malformed/non-SHA lines', () => {
		const out = `not-a-sha\trefs/heads/main\n${SHA_A.toUpperCase()}\trefs/heads/main\n`;
		expect(parseLsRemote(out, 'main')).toBe(SHA_A);
	});

	test('does not match a branch that is a prefix of another', () => {
		const out = `${SHA_A}\trefs/heads/main-2\n`;
		expect(parseLsRemote(out, 'main')).toBeNull();
	});
});
