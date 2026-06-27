import { afterEach, describe, expect, mock, test } from 'bun:test';

// teardownPreview deletes one environments row guarded to kind='preview' so it can't drop a user's persistent env.

let deleted: { table: string; conds: Array<{ col: unknown; val: unknown }> } | null = null;

mock.module('@kubwave/db', () => ({
	environments: { __t: 'environments', id: 'id', kind: 'kind' },
	db: {
		delete: (table: { __t?: string }) => ({
			where: async (conds: Array<{ col: unknown; val: unknown }>) => {
				deleted = { table: table.__t ?? '?', conds };
			}
		})
	}
}));

// eq → {col,val}; and → flatten its args into a single array we can inspect.
mock.module('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ col, val }),
	and: (...parts: unknown[]) => parts
}));

const { teardownPreview } = await import('~/modules/worker/jobs/pr-preview/teardown');

afterEach(() => {
	deleted = null;
});

describe('teardownPreview', () => {
	test('deletes the environments row guarded to (id, kind=preview)', async () => {
		await teardownPreview('env-9');
		expect(deleted?.table).toBe('environments');
		const conds = deleted!.conds;
		expect(conds).toContainEqual({ col: 'id', val: 'env-9' });
		expect(conds).toContainEqual({ col: 'kind', val: 'preview' });
	});

	test('resolves (no throw) — gcOrphans reclaims the namespace afterward', async () => {
		await expect(teardownPreview('env-x')).resolves.toBeUndefined();
	});
});
