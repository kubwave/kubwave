import { afterEach, describe, expect, mock, test } from 'bun:test';

// claimPending runs one tx: count in-flight → computeClaimLimit → SELECT FOR UPDATE SKIP LOCKED → flip to deploying + log. Mocks the IO seams.

let maxConcurrent = 3;
// The two awaited selects inside the tx, in order: [0] inflight count, [1] claimable rows.
let inflightCount = 0;
let claimableRows: Array<{ id: string; startedAt: Date | null; attempts: number }> = [];
const updatedIds: string[] = [];
const updatedSets: Array<Record<string, unknown>> = [];
const insertedLogValues: unknown[] = [];

mock.module('~/shared/config/worker-env', () => ({ env: { workerId: 'worker-test' } }));

// Keep computeClaimLimit + the status set real (pure); only stub the DB-backed cap read.
const realConcurrency = await import('~/modules/worker/jobs/deployments/concurrency');
mock.module('~/modules/worker/jobs/deployments/concurrency', () => ({
	computeClaimLimit: realConcurrency.computeClaimLimit,
	getMaxConcurrentDeployments: async () => maxConcurrent
}));

mock.module('~/modules/worker/jobs/deployments/logs', () => ({
	logEntry: (level: string, step: string, message: string) => ({ level, step, message }),
	deploymentLogRows: (deploymentId: string, entries: unknown[]) => entries.map(e => ({ deploymentId, e }))
}));

// A fake tx: first select() resolves to the inflight count, second to the claimable rows.
function makeTx() {
	let selectCall = 0;
	return {
		select: () => {
			const current = selectCall++;
			const rows = current === 0 ? [{ value: inflightCount }] : claimableRows;
			// The claimable select adds .orderBy().limit().for(); the count select awaits .where().
			const where = () => {
				const thenable = Promise.resolve(rows) as Promise<unknown> & {
					orderBy: () => typeof thenable;
					limit: () => typeof thenable;
					for: () => typeof thenable;
				};
				thenable.orderBy = () => thenable;
				thenable.limit = () => thenable;
				thenable.for = () => thenable;
				return thenable;
			};
			return { from: () => ({ where }) };
		},
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					updatedSets.push(values);
				}
			})
		}),
		insert: () => ({
			values: async (vals: unknown) => {
				insertedLogValues.push(vals);
			}
		})
	};
}

mock.module('@kubwave/db', () => ({
	deployments: { id: 'id', status: 'status', serviceId: 'serviceId', createdAt: 'createdAt' },
	deploymentLogs: {},
	db: {
		transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx())
	}
}));

const { claimPending, CLAIM_BATCH } = await import('~/modules/worker/jobs/deployments/claim');

afterEach(() => {
	maxConcurrent = 3;
	inflightCount = 0;
	claimableRows = [];
	updatedIds.length = 0;
	updatedSets.length = 0;
	insertedLogValues.length = 0;
});

describe('claimPending', () => {
	test('CLAIM_BATCH bounds per-tick claims', () => {
		expect(CLAIM_BATCH).toBe(5);
	});

	test('returns [] without selecting rows when the cap is already met', async () => {
		maxConcurrent = 3;
		inflightCount = 3; // no free slots
		claimableRows = [{ id: 'd1', startedAt: null, attempts: 0 }];
		const claimed = await claimPending();
		expect(claimed).toEqual([]);
		expect(updatedSets).toEqual([]); // never flipped any row
		expect(insertedLogValues).toEqual([]);
	});

	test('claims queued rows and flips them to deploying under this worker', async () => {
		maxConcurrent = 5;
		inflightCount = 0;
		claimableRows = [
			{ id: 'd1', startedAt: null, attempts: 0 },
			{ id: 'd2', startedAt: new Date('2026-06-15T00:00:00.000Z'), attempts: 2 }
		];
		const claimed = await claimPending();
		expect(claimed.map(r => r.id)).toEqual(['d1', 'd2']);
		expect(updatedSets).toHaveLength(2);
		expect(updatedSets[0]).toMatchObject({ status: 'deploying', phase: 'applying', lockedBy: 'worker-test', attempts: 1 });
		expect(updatedSets[1]).toMatchObject({ attempts: 3 });
		// startedAt preserved when already set, stamped when null.
		expect(updatedSets[1]?.startedAt).toEqual(new Date('2026-06-15T00:00:00.000Z'));
		expect(updatedSets[0]?.startedAt).toBeInstanceOf(Date);
		expect(insertedLogValues).toHaveLength(2);
	});

	test('claims nothing when there are no queued rows even with free slots', async () => {
		maxConcurrent = 5;
		inflightCount = 0;
		claimableRows = [];
		const claimed = await claimPending();
		expect(claimed).toEqual([]);
		expect(updatedSets).toEqual([]);
	});
});
