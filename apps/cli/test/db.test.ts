import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let queryCalls: { strings: string[]; values: unknown[] }[] = [];
let endCalled = false;

const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
	process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
	queryCalls = [];
	endCalled = false;
});

afterEach(() => {
	if (originalDbUrl !== undefined) {
		process.env.DATABASE_URL = originalDbUrl;
	} else {
		delete process.env.DATABASE_URL;
	}
});

const fakeDb = mock((strings: TemplateStringsArray, ...values: unknown[]) => {
	queryCalls.push({ strings: [...strings], values });
	return Promise.resolve();
});

const postgresModuleMock = mock(() => fakeDb);

(fakeDb as unknown as Record<string, unknown>)['end'] = mock(async () => {
	endCalled = true;
});

mock.module('postgres', () => ({
	default: postgresModuleMock
}));

const { updateRunStatus, setRunOldImageTags, closeDb } = await import('../src/lib/db.js');

describe('db helpers', () => {
	// Locate the outer UPDATE update_runs call: terminal branches emit nested fragment calls, so it's not at a fixed index.
	const updateCall = () => {
		const call = queryCalls.find(c => c.strings.join('').includes('UPDATE update_runs'));
		expect(call).toBeDefined();
		return call!;
	};

	test('updateRunStatus writes running status with phase', async () => {
		await updateRunStatus('run-123', 'running', 'prepare');
		// running branch is a single statement, no nested fragments.
		expect(queryCalls.length).toBe(1);
		const { strings, values } = queryCalls[0]!;
		// SET status = ${status}, phase = ${phase}, started_at = COALESCE(..., ${now}) WHERE id = ${runId}
		expect(values[0]).toBe('running'); // status column, position 0
		expect(values[1]).toBe('prepare'); // phase column, position 1 (would fail if swapped with status)
		expect(values[3]).toBe('run-123'); // runId, last position
		const sql = strings.join('');
		expect(sql).toContain('started_at');
		// running (non-terminal) must NOT touch finished_at / last_error
		expect(sql).not.toContain('finished_at');
		expect(sql).not.toContain('last_error');
	});

	test('updateRunStatus writes succeeded status with finished_at', async () => {
		await updateRunStatus('run-456', 'succeeded', 'finalize');
		const { strings, values } = updateCall();
		// SET status = ${status}, phase = ${phase}, finished_at = ${now} WHERE id = ${runId}
		expect(values[0]).toBe('succeeded'); // status column, position 0
		expect(values[1]).toBe('finalize'); // phase column, position 1 (would fail if swapped with status)
		expect(values[values.length - 1]).toBe('run-456'); // runId, last position
		const sql = strings.join('');
		expect(sql).toContain('finished_at'); // terminal status sets finished_at
		expect(sql).not.toContain('started_at');
		// no error passed → no last_error fragment anywhere
		expect(queryCalls.map(c => c.strings.join('')).join('')).not.toContain('last_error');
	});

	test('updateRunStatus writes failed status with error', async () => {
		await updateRunStatus('run-789', 'failed', 'helm-upgrade', 'upgrade failed');
		const { strings, values } = updateCall();
		// SET status = ${status}, phase = ${phase}, finished_at = ${now}, last_error = ${error} WHERE id = ${runId}
		expect(values[0]).toBe('failed'); // status column, position 0
		expect(values[1]).toBe('helm-upgrade'); // phase column, position 1 (would fail if swapped with status)
		expect(values[values.length - 1]).toBe('run-789'); // runId, last position
		const sql = strings.join('');
		expect(sql).toContain('finished_at'); // terminal status sets finished_at
		// last_error fragment is emitted as a separate nested db`` call when error is present
		const lastErrorFragment = queryCalls.find(c => c.strings.join('').includes('last_error'));
		expect(lastErrorFragment).toBeDefined();
		expect(lastErrorFragment!.values[0]).toBe('upgrade failed'); // error value bound to last_error fragment
	});

	test('updateRunStatus writes rolled_back status', async () => {
		await updateRunStatus('run-000', 'rolled_back', 'rollback');
		const { strings, values } = updateCall();
		// SET status = ${status}, phase = ${phase}, finished_at = ${now} WHERE id = ${runId}
		expect(values[0]).toBe('rolled_back'); // status column, position 0
		expect(values[1]).toBe('rollback'); // phase column, position 1 (would fail if swapped with status)
		expect(values[values.length - 1]).toBe('run-000'); // runId, last position
		const sql = strings.join('');
		expect(sql).toContain('finished_at'); // terminal status sets finished_at
		expect(sql).not.toContain('started_at');
		// no error passed → no last_error fragment anywhere
		expect(queryCalls.map(c => c.strings.join('')).join('')).not.toContain('last_error');
	});

	test('setRunOldImageTags stores tags as JSON', async () => {
		await setRunOldImageTags('run-123', { api: 'v1.0.0', worker: 'v1.0.0' });
		expect(queryCalls.length).toBe(1);
		expect(queryCalls[0]!.strings.join('')).toContain('old_image_tags');
	});

	test('closeDb ends connection and resets', async () => {
		await updateRunStatus('any', 'succeeded', 'done');
		await closeDb();
		expect(endCalled).toBe(true);
	});

	test('connects via POSTGRES_* env vars when DATABASE_URL is not set', async () => {
		delete process.env.DATABASE_URL;
		process.env.POSTGRES_HOST = 'pg.example.com';
		process.env.POSTGRES_USER = 'app';
		process.env.POSTGRES_PASSWORD = 'secret';
		process.env.POSTGRES_DB = 'kubwave';
		process.env.POSTGRES_PORT = '5433';

		postgresModuleMock.mockClear();

		await closeDb();
		await updateRunStatus('run-pg', 'running', 'prepare');

		expect(postgresModuleMock).toHaveBeenCalled();
		const calls = postgresModuleMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
		const callArgs = calls[0]?.[0];
		expect(callArgs).toBeDefined();
		expect(callArgs?.host).toBe('pg.example.com');
		expect(callArgs?.port).toBe(5433);

		delete process.env.POSTGRES_HOST;
		delete process.env.POSTGRES_USER;
		delete process.env.POSTGRES_PASSWORD;
		delete process.env.POSTGRES_DB;
		delete process.env.POSTGRES_PORT;
		process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
	});
});
