import { afterEach, describe, expect, mock, test } from 'bun:test';

// claimDueEnvironments SKIP-LOCKED claims in a tx, then leases each claimed row forward.

let dueRows: Array<{ id: string }> = [];
const updates: Array<{ id: string; set: Record<string, unknown> }> = [];

mock.module('~/shared/config/worker-env', () => ({ env: { prDiscoveryEnvIntervalSeconds: 60 } }));

// Chainable select: every method returns `this`; .for() resolves the queued rows.
function selectBuilder() {
	const b: Record<string, unknown> = {};
	for (const m of ['select', 'from', 'where', 'orderBy', 'limit']) b[m] = () => b;
	b.for = async () => dueRows;
	return b;
}

const tx = {
	select: () => selectBuilder(),
	update: () => ({
		set: (set: Record<string, unknown>) => ({
			where: async (cond: { __id?: string }) => {
				updates.push({ id: cond.__id ?? '?', set });
			}
		})
	})
};

mock.module('@kubwave/db', () => ({
	environments: { id: 'id', kind: 'kind', prPreviewsEnabled: 'e', prNextPollAt: 'np' },
	db: {
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)
	}
}));

// Intercept eq so the per-row update where() can recover which id it targeted.
mock.module('drizzle-orm', () => {
	const passthrough = () => ({});
	return {
		and: passthrough,
		or: passthrough,
		isNull: passthrough,
		lte: passthrough,
		sql: () => ({}),
		eq: (_col: unknown, val: unknown) => ({ __id: val })
	};
});

const { claimDueEnvironments } = await import('~/modules/worker/jobs/pr-preview/claim');

const now = new Date('2026-06-16T12:00:00.000Z');

afterEach(() => {
	dueRows = [];
	updates.length = 0;
});

describe('claimDueEnvironments', () => {
	test('returns the claimed rows and leases each one forward', async () => {
		dueRows = [{ id: 'env-a' }, { id: 'env-b' }];
		const rows = await claimDueEnvironments(now, 10);
		expect(rows).toEqual(dueRows as typeof rows);
		expect(updates.map(u => u.id)).toEqual(['env-a', 'env-b']);
		for (const u of updates) {
			expect(u.set.prLastPolledAt).toBe(now);
			expect(u.set.prNextPollAt).toBeInstanceOf(Date);
			expect((u.set.prNextPollAt as Date).getTime()).toBeGreaterThan(now.getTime());
		}
	});

	test('claims nothing and writes no lease when no env is due', async () => {
		dueRows = [];
		const rows = await claimDueEnvironments(now, 10);
		expect(rows).toEqual([]);
		expect(updates).toEqual([]);
	});
});
