import { afterEach, describe, expect, mock, test } from 'bun:test';
import { BatchV1Api, type KubeConfig } from '@kubernetes/client-node';

// reapOrphanUpdateJobs lists updater-labelled Jobs, diffs against the jobNames the DB still
// references, and deletes the rest. A 404 on delete is swallowed; other errors propagate.

let knownRows: Array<{ jobName: string | null }> = [];
let listItems: Array<{ metadata?: { name?: string } }> = [];
const deleted: string[] = [];
let deleteThrowsFor: Record<string, unknown> = {};

mock.module('~/shared/config/worker-env', () => ({ env: { podNamespace: 'kubwave' } }));

const batchApi = {
	listNamespacedJob: async ({ namespace, labelSelector }: { namespace: string; labelSelector: string }) => {
		lastList = { namespace, labelSelector };
		return { items: listItems };
	},
	deleteNamespacedJob: async ({ name }: { name: string }) => {
		if (deleteThrowsFor[name]) throw deleteThrowsFor[name];
		deleted.push(name);
	}
};
let lastList: { namespace: string; labelSelector: string } | null = null;
const fakeKc = { makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batchApi : {}) } as unknown as KubeConfig;

mock.module('@kubwave/kube', () => ({
	getKubeConfig: () => fakeKc,
	isNotFound: (err: unknown) => Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 404)
}));

mock.module('@kubwave/db', () => ({
	updateRuns: { jobName: {} },
	db: { select: () => ({ from: () => ({ where: async () => knownRows }) }) }
}));

const { reapOrphanUpdateJobs } = await import('~/modules/worker/jobs/updates/reaper');

afterEach(() => {
	knownRows = [];
	listItems = [];
	deleted.length = 0;
	deleteThrowsFor = {};
	lastList = null;
});

describe('reapOrphanUpdateJobs', () => {
	test('deletes only the Jobs with no DB row, keeps the known ones', async () => {
		knownRows = [{ jobName: 'update-known' }, { jobName: null }];
		listItems = [{ metadata: { name: 'update-known' } }, { metadata: { name: 'update-orphan-1' } }, { metadata: { name: 'update-orphan-2' } }];
		await reapOrphanUpdateJobs();
		expect(deleted.sort()).toEqual(['update-orphan-1', 'update-orphan-2']);
	});

	test('lists with the updater component label in the platform namespace', async () => {
		await reapOrphanUpdateJobs();
		expect(lastList).toEqual({ namespace: 'kubwave', labelSelector: 'app.kubernetes.io/component=updater' });
	});

	test('no orphans → nothing deleted', async () => {
		knownRows = [{ jobName: 'update-a' }];
		listItems = [{ metadata: { name: 'update-a' } }];
		await reapOrphanUpdateJobs();
		expect(deleted).toEqual([]);
	});

	test('skips list items without a name', async () => {
		listItems = [{ metadata: {} }, { metadata: { name: 'update-orphan' } }];
		await reapOrphanUpdateJobs();
		expect(deleted).toEqual(['update-orphan']);
	});

	test('a 404 on delete is swallowed (Job already gone)', async () => {
		listItems = [{ metadata: { name: 'update-gone' } }];
		deleteThrowsFor = { 'update-gone': { code: 404 } };
		await expect(reapOrphanUpdateJobs()).resolves.toBeUndefined();
		expect(deleted).toEqual([]); // delete attempted but threw 404, never pushed
	});

	test('a non-404 delete error propagates', async () => {
		listItems = [{ metadata: { name: 'update-locked' } }];
		deleteThrowsFor = { 'update-locked': { code: 403, message: 'forbidden' } };
		await expect(reapOrphanUpdateJobs()).rejects.toMatchObject({ code: 403 });
	});

	test('empty cluster list → no-op', async () => {
		knownRows = [{ jobName: 'update-a' }];
		listItems = [];
		await reapOrphanUpdateJobs();
		expect(deleted).toEqual([]);
	});
});
