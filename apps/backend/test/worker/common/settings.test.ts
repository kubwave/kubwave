import { describe, expect, mock, test } from 'bun:test';

// Thin key/value store over drizzle; capture the select/insert chains to assert the SQL shape (eq key, upsert).
let selectRow: unknown | undefined;
let whereArg: unknown;
let insertValues: unknown;
let conflictArg: unknown;

mock.module('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ col, val })
}));

mock.module('@kubwave/db', () => ({
	settings: { key: 'settings.key', value: 'settings.value', updatedAt: 'settings.updatedAt' },
	db: {
		select: () => ({
			from: () => ({
				where: (arg: unknown) => {
					whereArg = arg;
					return { limit: async () => (selectRow === undefined ? [] : [selectRow]) };
				}
			})
		}),
		insert: () => ({
			values: (vals: unknown) => {
				insertValues = vals;
				return {
					onConflictDoUpdate: async (arg: unknown) => {
						conflictArg = arg;
					}
				};
			}
		})
	}
}));

const { getSetting, setSetting } = await import('~/shared/worker-common/settings');

describe('getSetting', () => {
	test('returns the row value when a row exists, keyed by the requested key', async () => {
		selectRow = { key: 'k', value: { a: 1 } };
		const value = await getSetting<{ a: number }>('k');
		expect(value).toEqual({ a: 1 });
		expect(whereArg).toEqual({ col: 'settings.key', val: 'k' });
	});

	test('returns null when no row matches', async () => {
		selectRow = undefined;
		expect(await getSetting('missing')).toBeNull();
	});
});

describe('setSetting', () => {
	test('upserts the key/value with onConflictDoUpdate on settings.key', async () => {
		await setSetting('my-key', { enabled: true });
		expect(insertValues).toEqual({ key: 'my-key', value: { enabled: true } });
		expect(conflictArg).toMatchObject({ target: 'settings.key' });
		const set = (conflictArg as { set: { value: unknown; updatedAt: unknown } }).set;
		expect(set.value).toEqual({ enabled: true });
		expect(set.updatedAt).toBeInstanceOf(Date);
	});
});
