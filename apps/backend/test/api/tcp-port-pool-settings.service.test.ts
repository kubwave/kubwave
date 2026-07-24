import { beforeEach, describe, expect, mock, test } from 'bun:test';

let activeRun = false;
let exposedPorts: number[] = [];
let savedSetting: unknown = null;
const createdRuns: Array<Record<string, unknown>> = [];

const settingsTable = { key: 'key', value: 'value' };
const exposuresTable = { publicPort: 'public_port' };
const updateRunsTable = { id: 'id', status: 'status' };

interface FakeDb {
	select: () => unknown;
	insert: (table: unknown) => unknown;
	transaction: <T>(callback: (tx: FakeDb) => Promise<T>) => Promise<T>;
}

function selectFrom(table: unknown) {
	if (table === updateRunsTable) {
		return { where: () => ({ limit: async () => (activeRun ? [{ id: 'active-run' }] : []) }) };
	}
	if (table === exposuresTable) {
		const exposures = { orderBy: async () => exposedPorts.map(publicPort => ({ publicPort })) };
		return { ...exposures, where: () => exposures };
	}
	return { where: () => ({ limit: async () => (savedSetting === null ? [] : [{ value: savedSetting }]) }) };
}

const fakeDb: FakeDb = {
	select: () => ({ from: selectFrom }),
	insert: (table: unknown) => ({
		values: (value: Record<string, unknown>) => {
			if (table === settingsTable) {
				return {
					onConflictDoUpdate: async () => {
						savedSetting = value.value;
					}
				};
			}
			return {
				returning: async () => {
					const run = {
						id: '00000000-0000-4000-8000-000000000001',
						...value,
						startedAt: null,
						finishedAt: null,
						phase: null,
						lastError: null,
						jobName: null,
						oldImageTags: null,
						createdAt: new Date('2026-07-22T00:00:00.000Z')
					};
					createdRuns.push(run);
					return [run];
				}
			};
		}
	}),
	transaction: async <T>(callback: (tx: FakeDb) => Promise<T>) => callback(fakeDb)
};

mock.module('@kubwave/db', () => ({
	db: fakeDb,
	settings: settingsTable,
	servicePortExposures: exposuresTable,
	updateRuns: updateRunsTable
}));
mock.module('drizzle-orm', () => ({
	asc: () => undefined,
	desc: () => undefined,
	eq: () => undefined,
	gt: () => undefined,
	inArray: () => undefined,
	lt: () => undefined,
	or: () => undefined
}));

const { PlatformTcpPortPoolSettingsService } = await import('~/modules/platform/settings/tcp-port-pool/platform-tcp-port-pool-settings.service');
const { UpdateConcurrentError } = await import('~/modules/platform/updates/platform-updates.errors');

function service() {
	return new PlatformTcpPortPoolSettingsService({ getInstalledVersion: () => '1.2.3' } as never);
}

beforeEach(() => {
	activeRun = false;
	exposedPorts = [];
	savedSetting = null;
	createdRuns.length = 0;
});

describe('PlatformTcpPortPoolSettingsService', () => {
	test('persists the pool and creates an atomic same-version reconcile run', async () => {
		const result = await service().updateSettings({ enabled: true, start: 31000, size: 5 }, '00000000-0000-4000-8000-000000000002');

		expect(savedSetting).toEqual({ enabled: true, start: 31000, size: 5 });
		expect(createdRuns).toHaveLength(1);
		expect(result.updateRun).toMatchObject({ kind: 'tcp_port_pool', fromVersion: '1.2.3', toVersion: '1.2.3', status: 'pending' });
	});

	test('rejects pool changes while another update is active without saving the setting', async () => {
		activeRun = true;

		await expect(service().updateSettings({ enabled: true, start: 31000, size: 5 }, '00000000-0000-4000-8000-000000000002')).rejects.toBeInstanceOf(
			UpdateConcurrentError
		);
		expect(savedSetting).toBeNull();
		expect(createdRuns).toHaveLength(0);
	});

	test('rejects a pool that would orphan an active public service port', async () => {
		exposedPorts = [30100];

		await expect(service().updateSettings({ enabled: true, start: 31000, size: 5 }, '00000000-0000-4000-8000-000000000002')).rejects.toMatchObject({
			code: 'tcp_port_pool_conflict',
			details: { publicPorts: [30100] }
		});
		expect(savedSetting).toBeNull();
		expect(createdRuns).toHaveLength(0);
	});
});
