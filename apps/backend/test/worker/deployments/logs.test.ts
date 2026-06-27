import { describe, expect, mock, test } from 'bun:test';

process.env.POSTGRES_HOST ??= 'localhost';
process.env.POSTGRES_USER ??= 'app';
process.env.POSTGRES_PASSWORD ??= 'app';
process.env.POSTGRES_DB ??= 'app';

// Capture the IO seams insertLogs/finalize drive; `updateResult` is what returning() resolves
// with — drives the finalize "wrote vs raced" branch.
let insertedRows: unknown[] | null = null;
let updateSet: Record<string, unknown> | null = null;
let updateResult: unknown[] = [];
mock.module('@kubwave/db', () => ({
	deploymentLogs: {},
	deployments: { id: 'id', status: 'status' },
	db: {
		insert: () => ({
			values: (rows: unknown[]) => {
				insertedRows = rows;
				return Promise.resolve();
			}
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				updateSet = values;
				return { where: () => ({ returning: async () => updateResult }) };
			}
		})
	}
}));

const { stepEvent } = await import('~/shared/cluster/networking');
const { logEntry, phaseEntry, deploymentLogRows, insertLogs, finalize } = await import('~/modules/worker/jobs/deployments/logs');
const { parseTimestampedBuildLog } = await import('~/modules/worker/jobs/deployments/builds/logs');

describe('deployment log entries', () => {
	test('keeps deployment events small and message-based', () => {
		const entry = logEntry('info', 'queued', 'Queued');

		expect(entry.level).toBe('info');
		expect(entry.step).toBe('queued');
		expect(entry.message).toBe('Queued');
		expect(entry).not.toHaveProperty('category');
		expect(entry).not.toHaveProperty('resource');
		expect(entry).not.toHaveProperty('details');
	});

	test('worker step events use the same reduced shape', () => {
		const entry = stepEvent('deployment-created', 'Created Deployment svc-1 with image nginx:latest');

		expect(entry.level).toBe('info');
		expect(entry.step).toBe('deployment-created');
		expect(entry.message).toContain('svc-1');
		expect(entry).not.toHaveProperty('category');
	});

	test('phase entries do not attach structured metadata', () => {
		const entry = phaseEntry('rolling-out');

		expect(entry.step).toBe('rolling-out');
		expect(entry.message).toBe('Waiting for rollout…');
		expect(entry).not.toHaveProperty('details');
	});

	test('parses full timestamped build output into stable line rows', () => {
		const parsed = parseTimestampedBuildLog(
			'2026-06-16T08:01:02.000000000Z installing dependencies\n2026-06-16T08:01:03.000000000Z installing dependencies\n'
		);

		expect(parsed).toHaveLength(2);
		expect(parsed[0]?.sourceTs.toISOString()).toBe('2026-06-16T08:01:02.000Z');
		expect(parsed[0]?.message).toBe('installing dependencies');
		expect(parsed[1]?.message).toBe('installing dependencies');
		expect(parsed[0]?.lineHash).not.toBe(parsed[1]?.lineHash);
	});
});

describe('phaseEntry phase mapping', () => {
	test('an `error:` phase becomes a warn-level entry with the trimmed reason', () => {
		const entry = phaseEntry('error: ImagePullBackOff');
		expect(entry.level).toBe('warn');
		expect(entry.step).toBe('error');
		expect(entry.message).toBe('ImagePullBackOff');
	});

	test('maps known build/rollout phases to human messages', () => {
		expect(phaseEntry('applying').message).toBe('Applying manifests…');
		expect(phaseEntry('building').message).toBe('Building image…');
		expect(phaseEntry('pushing').message).toBe('Pushing image to the registry…');
		expect(phaseEntry('image-ready').message).toBe('Image built — applying manifests…');
	});

	test('an unknown phase echoes itself as both step and message', () => {
		const entry = phaseEntry('mystery');
		expect(entry.step).toBe('mystery');
		expect(entry.message).toBe('mystery');
		expect(entry.level).toBe('info');
	});
});

describe('deploymentLogRows', () => {
	test('maps entries to event rows carrying the deployment id and parsed ts', () => {
		const rows = deploymentLogRows('dep-1', [logEntry('info', 'queued', 'Queued')]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ deploymentId: 'dep-1', kind: 'event', level: 'info', step: 'queued', message: 'Queued' });
		expect(rows[0]?.ts).toBeInstanceOf(Date);
	});
});

describe('insertLogs', () => {
	test('skips the db write entirely for an empty batch', async () => {
		insertedRows = null;
		await insertLogs('dep-1', []);
		expect(insertedRows).toBeNull();
	});

	test('writes mapped rows for a non-empty batch', async () => {
		insertedRows = null;
		await insertLogs('dep-2', [logEntry('info', 'queued', 'Queued')]);
		expect(insertedRows).toHaveLength(1);
		expect((insertedRows as unknown as Array<{ deploymentId: string }>)[0]?.deploymentId).toBe('dep-2');
	});
});

describe('finalize', () => {
	test('writes the terminal logs when the guarded update matched a row', async () => {
		updateResult = [{ id: 'dep-3' }]; // status still matched → row updated
		updateSet = null;
		insertedRows = null;
		await finalize('dep-3', 'deploying', { status: 'succeeded', phase: 'done', lastError: null }, [
			logEntry('info', 'succeeded', 'Deployment succeeded')
		]);
		expect(updateSet).toMatchObject({ status: 'succeeded', phase: 'done', lastError: null });
		expect((updateSet as Record<string, unknown> | null)?.finishedAt).toBeInstanceOf(Date);
		expect(insertedRows).toHaveLength(1);
	});

	test('skips the log write when the row was already moved on (race lost)', async () => {
		updateResult = []; // guard didn't match → nothing updated
		insertedRows = null;
		await finalize('dep-4', 'deploying', { status: 'succeeded', phase: 'done', lastError: null }, [
			logEntry('info', 'succeeded', 'Deployment succeeded')
		]);
		expect(insertedRows).toBeNull();
	});
});
