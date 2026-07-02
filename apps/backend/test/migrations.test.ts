import { beforeEach, describe, expect, mock, test } from 'bun:test';

let lockGranted = true;
let runMigrationsCalls = 0;
let connCalls: string[] = [];

function makeConn() {
	const conn = ((strings: TemplateStringsArray) => {
		const query = strings.join('?');
		connCalls.push(query);
		if (query.includes('pg_try_advisory_lock')) return Promise.resolve([{ locked: lockGranted }]);
		return Promise.resolve([]);
	}) as unknown as ((strings: TemplateStringsArray) => Promise<unknown[]>) & { release: () => void };
	conn.release = () => connCalls.push('release');
	return conn;
}

mock.module('@kubwave/db', () => ({
	sql: { reserve: async () => makeConn() },
	runMigrations: async () => {
		runMigrationsCalls++;
	}
}));

const { migrateOnBoot, runBootMigrationsWithRetry } = await import('~/shared/db/migrations');

beforeEach(() => {
	lockGranted = true;
	runMigrationsCalls = 0;
	connCalls = [];
});

describe('migrateOnBoot', () => {
	test('acquires the lock, migrates, unlocks, and releases the connection', async () => {
		await migrateOnBoot();
		expect(runMigrationsCalls).toBe(1);
		expect(connCalls.some(q => q.includes('pg_try_advisory_lock'))).toBe(true);
		expect(connCalls.some(q => q.includes('pg_advisory_unlock'))).toBe(true);
		expect(connCalls).toContain('release');
	});

	test('a held lock is a retryable error, not an indefinite hang — and never runs migrations', async () => {
		lockGranted = false;
		await expect(migrateOnBoot()).rejects.toThrow('advisory lock');
		expect(runMigrationsCalls).toBe(0);
		// Connection is still released so the pool does not leak.
		expect(connCalls).toContain('release');
	});
});

describe('runBootMigrationsWithRetry', () => {
	test('retries a transient failure (e.g. a held lock) and then succeeds', async () => {
		let attempts = 0;
		await runBootMigrationsWithRetry({
			retryMs: 1,
			timeoutMs: 1000,
			migrate: async () => {
				if (++attempts < 3) throw new Error('lock held by another instance');
			}
		});
		expect(attempts).toBe(3);
	});

	test('gives up after the deadline so the failure is visible (pod exits) instead of hanging', async () => {
		await expect(
			runBootMigrationsWithRetry({
				retryMs: 1,
				timeoutMs: 0,
				migrate: async () => {
					throw new Error('lock never released');
				}
			})
		).rejects.toThrow('lock never released');
	});
});
