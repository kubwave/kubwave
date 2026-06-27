// ../src/client throws at import if connection env is unset, and imports hoist — set env first, then dynamically import (postgres() is lazy, no DB needed).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/test';
const { createDb, db, sql } = await import('../src/client');

// Env keys createClient() reads; snapshot/restore so cases don't leak into each other.
const ENV_KEYS = ['DATABASE_URL', 'POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT'] as const;

function snapshotEnv(): Record<string, string | undefined> {
	return Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
}

function restoreEnv(saved: Record<string, string | undefined>): void {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
}

function clearEnv(): void {
	for (const k of ENV_KEYS) delete process.env[k];
}

describe('client module singletons', () => {
	test('exports a `sql` client and `db` ORM instance built at import time', () => {
		// Both consts ran via createClient()/drizzle() against the top-level DATABASE_URL.
		expect(sql).toBeDefined();
		expect(typeof sql).toBe('function'); // postgres() returns a tagged-template function
		expect(db).toBeDefined();
	});
});

describe('createDb', () => {
	// Each test mutates connection env, so save before / restore after.
	let saved: Record<string, string | undefined>;
	beforeEach(() => {
		saved = snapshotEnv();
	});
	afterEach(() => {
		restoreEnv(saved);
	});

	test('with DATABASE_URL set, returns defined { sql, db } (URL path)', () => {
		clearEnv();
		process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/test';
		const { sql: s, db: d } = createDb();
		expect(s).toBeDefined();
		expect(typeof s).toBe('function');
		expect(d).toBeDefined();
	});

	test('with discrete POSTGRES_* vars (no DATABASE_URL), returns a client', () => {
		clearEnv();
		process.env.POSTGRES_HOST = 'localhost';
		process.env.POSTGRES_USER = 'u';
		process.env.POSTGRES_PASSWORD = 'p';
		process.env.POSTGRES_DB = 'test';
		// POSTGRES_PORT intentionally unset → exercises the 5432 default branch.
		const { sql: s, db: d } = createDb();
		expect(s).toBeDefined();
		expect(typeof s).toBe('function');
		expect(d).toBeDefined();
	});

	test('with discrete vars including POSTGRES_PORT, returns a client (Number() port branch)', () => {
		clearEnv();
		process.env.POSTGRES_HOST = 'localhost';
		process.env.POSTGRES_USER = 'u';
		process.env.POSTGRES_PASSWORD = 'p';
		process.env.POSTGRES_DB = 'test';
		process.env.POSTGRES_PORT = '6543';
		const { sql: s } = createDb();
		expect(s).toBeDefined();
		expect(typeof s).toBe('function');
	});

	test('with neither DATABASE_URL nor full POSTGRES_* vars, throws', () => {
		clearEnv();
		expect(() => createDb()).toThrow(/DATABASE_URL or POSTGRES_HOST/);
	});

	test('with a partial POSTGRES_* set (missing PASSWORD/DB), throws', () => {
		clearEnv();
		process.env.POSTGRES_HOST = 'localhost';
		process.env.POSTGRES_USER = 'u';
		// PASSWORD and DB missing → discrete-vars guard fails.
		expect(() => createDb()).toThrow(/DATABASE_URL or POSTGRES_HOST/);
	});
});
