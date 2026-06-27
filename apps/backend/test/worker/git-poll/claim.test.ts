import { afterEach, describe, expect, mock, test } from 'bun:test';

// claimDueServices SKIP-LOCKED claims due services in a tx, then leases each claimed row forward.

let dueRows: Array<{ id: string }> = [];
const updates: Array<{ id: string; set: Record<string, unknown> }> = [];

mock.module('~/shared/config/worker-env', () => ({ env: { gitPollServiceIntervalSeconds: 60 } }));

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
	services: { id: 'id', type: 'type', config: 'config', autoDeployEnabled: 'ade', nextPollAt: 'np', lastPolledCommit: 'lpc' },
	db: {
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)
	}
}));

// eq(services.id, row.id) carries the id so the per-row update where() can record it.
mock.module('drizzle-orm', () => {
	const passthrough = () => ({});
	return {
		and: passthrough,
		or: passthrough,
		isNull: passthrough,
		lte: passthrough,
		inArray: passthrough,
		sql: () => ({}),
		eq: (_col: unknown, val: unknown) => ({ __id: val })
	};
});

const { claimDueServices } = await import('~/modules/worker/jobs/git-poll/claim');

const now = new Date('2026-06-14T12:00:00.000Z');

afterEach(() => {
	dueRows = [];
	updates.length = 0;
});

describe('claimDueServices', () => {
	test('returns the claimed services and leases each one forward', async () => {
		dueRows = [{ id: 'svc-a' }, { id: 'svc-b' }];
		const rows = await claimDueServices(now, 20);
		expect(rows).toEqual(dueRows as typeof rows);
		expect(updates.map(u => u.id)).toEqual(['svc-a', 'svc-b']);
		for (const u of updates) {
			expect(u.set.lastPolledAt).toBe(now);
			expect(u.set.nextPollAt).toBeInstanceOf(Date);
			expect((u.set.nextPollAt as Date).getTime()).toBeGreaterThan(now.getTime());
		}
	});

	test('claims nothing and writes no lease when no service is due', async () => {
		dueRows = [];
		const rows = await claimDueServices(now, 20);
		expect(rows).toEqual([]);
		expect(updates).toEqual([]);
	});
});
