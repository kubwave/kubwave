import { describe, expect, mock, test } from 'bun:test';
import { PortExposureDisabledError, PortPoolExhaustedError } from '~/modules/services/services.errors';
import type { TcpPortPoolConfig } from '~/shared/config/backend-config.service';

// port-exposures imports the db table from '@kubwave/db', whose root module creates a client on load; replace it (the fake tx below never reads it).
mock.module('@kubwave/db', () => ({
	servicePortExposures: { id: 'id', serviceId: 'serviceId', containerPort: 'containerPort', publicPort: 'publicPort' }
}));

const { reconcileExposedPorts } = await import('~/modules/services/port-exposures');

const SERVICE_ID = 'svc-1';
const pool: TcpPortPoolConfig = { enabled: true, start: 30100, size: 3 };

interface FakeRow {
	id: string;
	serviceId: string;
	containerPort: number;
	publicPort: number;
}

// Fake drizzle tx over in-memory rows: select 1 = this service's exposures, select 2 = pool-wide taken; insert emulates ON CONFLICT DO NOTHING via `taken`.
function fakeTx(existing: Array<Pick<FakeRow, 'containerPort' | 'publicPort'>>, globalTaken: number[] = []) {
	const state = {
		exposures: existing.map(row => ({ id: `id-${row.publicPort}`, serviceId: SERVICE_ID, ...row })),
		taken: new Set([...existing.map(row => row.publicPort), ...globalTaken]),
		deleteCalls: 0
	};
	let selectCount = 0;
	const tx = {
		select: () => ({
			from: () => ({
				where: async () => {
					selectCount++;
					return selectCount === 1 ? state.exposures : [...state.taken].map(publicPort => ({ publicPort }));
				}
			})
		}),
		delete: () => ({
			where: async () => {
				state.deleteCalls++;
			}
		}),
		insert: () => ({
			values: (row: { serviceId: string; containerPort: number; publicPort: number }) => ({
				onConflictDoNothing: () => ({
					returning: async () => {
						if (state.taken.has(row.publicPort)) return [];
						state.taken.add(row.publicPort);
						state.exposures.push({ id: `id-${row.publicPort}`, ...row });
						return [{ publicPort: row.publicPort }];
					}
				})
			})
		})
	};
	return { tx: tx as unknown as Parameters<typeof reconcileExposedPorts>[0], state };
}

describe('reconcileExposedPorts', () => {
	test('allocates the first free pool port for a new exposure', async () => {
		const { tx } = fakeTx([]);
		const result = await reconcileExposedPorts(tx, SERVICE_ID, [5432], pool);
		expect(result).toEqual([{ containerPort: 5432, publicPort: 30100 }]);
	});

	test('keeps existing allocations and only allocates newly added ports', async () => {
		const { tx, state } = fakeTx([{ containerPort: 5432, publicPort: 30101 }]);
		const result = await reconcileExposedPorts(tx, SERVICE_ID, [5432, 3306], pool);
		// 30100 is free (never taken), so the new port fills the gap, not 30102.
		expect(result).toEqual([
			{ containerPort: 3306, publicPort: 30100 },
			{ containerPort: 5432, publicPort: 30101 }
		]);
		expect(state.deleteCalls).toBe(0);
	});

	test('frees allocations whose container port is no longer exposed', async () => {
		const { tx, state } = fakeTx([{ containerPort: 5432, publicPort: 30100 }]);
		const result = await reconcileExposedPorts(tx, SERVICE_ID, [], pool);
		expect(result).toEqual([]);
		expect(state.deleteCalls).toBe(1);
	});

	test('skips pool ports already taken by other services', async () => {
		const { tx } = fakeTx([], [30100, 30101]);
		const result = await reconcileExposedPorts(tx, SERVICE_ID, [5432], pool);
		expect(result).toEqual([{ containerPort: 5432, publicPort: 30102 }]);
	});

	test('throws PortPoolExhaustedError when no pool port is free', async () => {
		const { tx } = fakeTx([], [30100, 30101, 30102]);
		await expect(reconcileExposedPorts(tx, SERVICE_ID, [5432], pool)).rejects.toBeInstanceOf(PortPoolExhaustedError);
	});

	test('throws PortExposureDisabledError for new exposures when the pool is off, but still allows removals', async () => {
		const disabled: TcpPortPoolConfig = { enabled: false, start: 30100, size: 0 };
		const { tx } = fakeTx([]);
		await expect(reconcileExposedPorts(tx, SERVICE_ID, [5432], disabled)).rejects.toBeInstanceOf(PortExposureDisabledError);

		const withExisting = fakeTx([{ containerPort: 5432, publicPort: 30100 }]);
		await expect(reconcileExposedPorts(withExisting.tx, SERVICE_ID, [], disabled)).resolves.toEqual([]);
		expect(withExisting.state.deleteCalls).toBe(1);
	});
});
