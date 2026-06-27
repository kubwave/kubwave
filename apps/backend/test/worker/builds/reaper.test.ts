import { describe, expect, mock, test } from 'bun:test';
import { BatchV1Api, CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';

// reaper.ts reads env at import and resolves active deployments through @kubwave/db.
// @kubwave/kube is left real — the SUT only uses its pure label constants.
mock.module('~/shared/config/worker-env', () => ({ env: { podNamespace: 'kubwave' } }));

let activeRows: Array<{ id: string; status: string }> = [];
mock.module('@kubwave/db', () => ({
	db: { select: () => ({ from: () => ({ where: async () => activeRows }) }) },
	deployments: { id: 'id', status: 'status' }
}));

const { reapOrphanBuildJobs } = await import('~/modules/worker/jobs/deployments/builds/reaper');

const DEP_LABEL = 'kubwave/deployment-id';
const labelled = (name: string, depId?: string) => ({ metadata: { name, labels: depId ? { [DEP_LABEL]: depId } : {} } });

interface Deleted {
	jobs: string[];
	configMaps: string[];
	secrets: string[];
	policies: string[];
}

function makeKc(opts: {
	jobs?: ReturnType<typeof labelled>[];
	configMaps?: ReturnType<typeof labelled>[];
	secrets?: ReturnType<typeof labelled>[];
	policies?: ReturnType<typeof labelled>[];
	deleted: Deleted;
	rejectDelete?: unknown;
}): KubeConfig {
	const batch = {
		listNamespacedJob: () => Promise.resolve({ items: opts.jobs ?? [] }),
		deleteNamespacedJob: (req: { name: string }) => {
			if (opts.rejectDelete) return Promise.reject(opts.rejectDelete);
			opts.deleted.jobs.push(req.name);
			return Promise.resolve({});
		}
	};
	const core = {
		listNamespacedConfigMap: () => Promise.resolve({ items: opts.configMaps ?? [] }),
		listNamespacedSecret: () => Promise.resolve({ items: opts.secrets ?? [] }),
		deleteNamespacedConfigMap: (req: { name: string }) => {
			opts.deleted.configMaps.push(req.name);
			return Promise.resolve({});
		},
		deleteNamespacedSecret: (req: { name: string }) => {
			opts.deleted.secrets.push(req.name);
			return Promise.resolve({});
		}
	};
	const net = {
		listNamespacedNetworkPolicy: () => Promise.resolve({ items: opts.policies ?? [] }),
		deleteNamespacedNetworkPolicy: (req: { name: string }) => {
			opts.deleted.policies.push(req.name);
			return Promise.resolve({});
		}
	};
	return {
		makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batch : klass === CoreV1Api ? core : klass === NetworkingV1Api ? net : {})
	} as unknown as KubeConfig;
}

const emptyDeleted = (): Deleted => ({ jobs: [], configMaps: [], secrets: [], policies: [] });

describe('reapOrphanBuildJobs', () => {
	test('returns early (no DB query) when no build artifacts are labelled', async () => {
		activeRows = [{ id: 'should-not-be-read', status: 'deploying' }];
		const deleted = emptyDeleted();
		await reapOrphanBuildJobs(makeKc({ deleted }));
		expect(deleted).toEqual({ jobs: [], configMaps: [], secrets: [], policies: [] });
	});

	test('returns early when artifacts exist but none carry a deployment-id label', async () => {
		const deleted = emptyDeleted();
		await reapOrphanBuildJobs(makeKc({ jobs: [labelled('job-x')], deleted }));
		expect(deleted.jobs).toEqual([]);
	});

	test('deletes only the artifacts whose deployment is no longer active', async () => {
		activeRows = [{ id: 'dep-active', status: 'deploying' }]; // dep-done absent / dep-old not active
		const deleted = emptyDeleted();
		await reapOrphanBuildJobs(
			makeKc({
				jobs: [labelled('job-active', 'dep-active'), labelled('job-old', 'dep-old')],
				configMaps: [labelled('cm-active', 'dep-active'), labelled('cm-old', 'dep-old')],
				secrets: [labelled('sec-old', 'dep-old')],
				policies: [labelled('np-active', 'dep-active'), labelled('np-old', 'dep-old')],
				deleted
			})
		);
		expect(deleted.jobs).toEqual(['job-old']);
		expect(deleted.configMaps).toEqual(['cm-old']);
		expect(deleted.secrets).toEqual(['sec-old']);
		expect(deleted.policies).toEqual(['np-old']);
	});

	test('treats a referenced deployment with no DB row (deleted) as an orphan and reaps it', async () => {
		activeRows = []; // the deployment row is gone → not active → reaped
		const deleted = emptyDeleted();
		await reapOrphanBuildJobs(
			makeKc({
				jobs: [labelled('job-gone', 'dep-gone')],
				secrets: [labelled('sec-gone', 'dep-gone')],
				policies: [labelled('np-gone', 'dep-gone')],
				deleted
			})
		);
		expect(deleted.jobs).toEqual(['job-gone']);
		expect(deleted.secrets).toEqual(['sec-gone']);
		expect(deleted.policies).toEqual(['np-gone']);
	});

	test('reaps nothing when every referenced deployment is still active', async () => {
		activeRows = [{ id: 'dep-1', status: 'canceling' }];
		const deleted = emptyDeleted();
		await reapOrphanBuildJobs(makeKc({ jobs: [labelled('job-1', 'dep-1')], deleted }));
		expect(deleted.jobs).toEqual([]);
	});

	test('tolerates a 404 on delete (artifact already gone) without throwing', async () => {
		activeRows = [];
		const deleted = emptyDeleted();
		await expect(
			reapOrphanBuildJobs(makeKc({ jobs: [labelled('job-gone', 'dep-gone')], deleted, rejectDelete: { code: 404 } }))
		).resolves.toBeUndefined();
	});
});
