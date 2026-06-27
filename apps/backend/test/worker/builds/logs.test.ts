import { describe, expect, mock, test } from 'bun:test';
import { BatchV1Api, CoreV1Api, type CoreV1Api as CoreV1ApiType, type KubeConfig } from '@kubernetes/client-node';

// logs.ts reads env at import and persists through @kubwave/db; stub both.
mock.module('~/shared/config/worker-env', () => ({ env: { podNamespace: 'kubwave' } }));

// Chainable insert that records the rows it was asked to persist.
let insertedRows: unknown[] = [];
let selectRows: unknown[] = [];
mock.module('@kubwave/db', () => ({
	db: {
		insert: () => ({
			values: (rows: unknown[]) => {
				insertedRows = insertedRows.concat(rows);
				return { onConflictDoNothing: async () => {} };
			}
		}),
		select: () => ({ from: () => ({ where: async () => selectRows }) })
	},
	deploymentLogs: { deploymentId: 'd', containerName: 'c', sourceTs: 's', lineHash: 'h' },
	deployments: { id: 'id', status: 'status' }
}));
// @kubwave/kube is left real: the SUT only uses its pure label constants here.

const { parseTimestampedBuildLog, captureBuildLogs, captureActiveBuildLogs, BUILD_LOG_CAPTURE_INTERVAL_MS } =
	await import('~/modules/worker/jobs/deployments/builds/logs');

function resetState() {
	insertedRows = [];
	selectRows = [];
}

describe('BUILD_LOG_CAPTURE_INTERVAL_MS', () => {
	test('is a 2s poll cadence', () => {
		expect(BUILD_LOG_CAPTURE_INTERVAL_MS).toBe(2000);
	});
});

describe('parseTimestampedBuildLog', () => {
	test('splits a leading RFC3339 timestamp off each line into sourceTs + message', () => {
		const out = parseTimestampedBuildLog('2026-06-17T10:00:00Z Building image\n2026-06-17T10:00:01Z done');
		expect(out).toHaveLength(2);
		expect(out[0]!.message).toBe('Building image');
		expect(out[0]!.sourceTs.toISOString()).toBe('2026-06-17T10:00:00.000Z');
		expect(out[1]!.message).toBe('done');
	});

	test('keeps a line without a parseable timestamp verbatim, dated to the epoch', () => {
		const out = parseTimestampedBuildLog('no timestamp here');
		expect(out).toHaveLength(1);
		expect(out[0]!.message).toBe('no timestamp here');
		expect(out[0]!.sourceTs.getTime()).toBe(0);
	});

	test('drops a single trailing empty line (kubelet log terminator)', () => {
		const out = parseTimestampedBuildLog('line one\n');
		expect(out).toHaveLength(1);
		expect(out[0]!.message).toBe('line one');
	});

	test('lineHash is deterministic per (index, message) — identical content at the same index re-hashes equal', () => {
		const a = parseTimestampedBuildLog('x\ny');
		const b = parseTimestampedBuildLog('x\ny');
		expect(a.map(l => l.lineHash)).toEqual(b.map(l => l.lineHash));
		// same message at different indices hashes differently (dedup is positional)
		const dup = parseTimestampedBuildLog('same\nsame');
		expect(dup[0]!.lineHash).not.toBe(dup[1]!.lineHash);
	});
});

describe('captureBuildLogs', () => {
	function coreWith(opts: { pod?: unknown; logs?: Record<string, string> }): CoreV1ApiType {
		return {
			listNamespacedPod: () => Promise.resolve({ items: opts.pod ? [opts.pod] : [] }),
			readNamespacedPodLog: (req: { container: string }) => {
				const log = opts.logs?.[req.container];
				if (log === undefined) return Promise.reject(new Error('container logs not available'));
				return Promise.resolve(log);
			}
		} as unknown as CoreV1ApiType;
	}

	test('persists one row per timestamped log line, tagged with the container', async () => {
		resetState();
		const api = coreWith({ pod: { metadata: { name: 'build-pod' } }, logs: { builder: '2026-06-17T10:00:00Z step 1\n2026-06-17T10:00:01Z step 2' } });
		await captureBuildLogs({ api, namespace: 'kubwave', jobName: 'job-1', deploymentId: 'dep-1', containers: ['builder'] });
		expect(insertedRows).toHaveLength(2);
		expect(insertedRows).toMatchObject([
			{ deploymentId: 'dep-1', containerName: 'builder', message: 'step 1', kind: 'build-output' },
			{ deploymentId: 'dep-1', containerName: 'builder', message: 'step 2' }
		]);
	});

	test('returns early (no insert) when the build pod does not exist yet', async () => {
		resetState();
		await captureBuildLogs({ api: coreWith({}), namespace: 'kubwave', jobName: 'job-1', deploymentId: 'dep-1', containers: ['builder'] });
		expect(insertedRows).toHaveLength(0);
	});

	test('skips a container whose log read throws (not started yet) and still captures the others', async () => {
		resetState();
		const api = coreWith({ pod: { metadata: { name: 'build-pod' } }, logs: { builder: '2026-06-17T10:00:00Z built' } });
		// 'prepare' has no entry → read rejects → skipped; 'builder' succeeds.
		await captureBuildLogs({ api, namespace: 'kubwave', jobName: 'job-1', deploymentId: 'dep-1', containers: ['prepare', 'builder'] });
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({ containerName: 'builder', message: 'built' });
	});

	test('skips a container that produced no log lines (empty output)', async () => {
		resetState();
		const api = coreWith({ pod: { metadata: { name: 'build-pod' } }, logs: { builder: '' } });
		await captureBuildLogs({ api, namespace: 'kubwave', jobName: 'job-1', deploymentId: 'dep-1', containers: ['builder'] });
		expect(insertedRows).toHaveLength(0);
	});
});

describe('captureActiveBuildLogs', () => {
	function makeKc(opts: { jobs: unknown[]; pod?: unknown; log?: string }): KubeConfig {
		const batch = { listNamespacedJob: () => Promise.resolve({ items: opts.jobs }) };
		const core = {
			listNamespacedPod: () => Promise.resolve({ items: opts.pod ? [opts.pod] : [] }),
			readNamespacedPodLog: () => Promise.resolve(opts.log ?? '')
		};
		return {
			makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batch : klass === CoreV1Api ? core : {})
		} as unknown as KubeConfig;
	}

	test('returns early when there are no builder Jobs in the namespace', async () => {
		resetState();
		await captureActiveBuildLogs(makeKc({ jobs: [] }));
		expect(insertedRows).toHaveLength(0);
	});

	test('returns early when no Job carries a deployment-id label', async () => {
		resetState();
		await captureActiveBuildLogs(makeKc({ jobs: [{ metadata: { name: 'job-x', labels: {} } }] }));
		expect(insertedRows).toHaveLength(0);
	});

	test('captures logs only for Jobs whose deployment is still in an active build status', async () => {
		resetState();
		// two builder Jobs; only dep-active's deployment row is active → only it is captured.
		selectRows = [
			{ id: 'dep-active', status: 'deploying' },
			{ id: 'dep-done', status: 'succeeded' }
		];
		const job = (name: string, depId: string) => ({
			metadata: { name, labels: { 'kubwave/deployment-id': depId } },
			spec: { template: { spec: { containers: [{ name: 'builder' }] } } }
		});
		const kc = makeKc({
			jobs: [job('job-active', 'dep-active'), job('job-done', 'dep-done')],
			pod: { metadata: { name: 'build-pod' } },
			log: '2026-06-17T10:00:00Z building'
		});
		await captureActiveBuildLogs(kc);
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({ deploymentId: 'dep-active', containerName: 'builder', message: 'building' });
	});

	test('returns early when no referenced deployment is active (all finished)', async () => {
		resetState();
		selectRows = [{ id: 'dep-1', status: 'succeeded' }];
		const kc = makeKc({
			jobs: [
				{
					metadata: { name: 'job-1', labels: { 'kubwave/deployment-id': 'dep-1' } },
					spec: { template: { spec: { containers: [{ name: 'builder' }] } } }
				}
			],
			pod: { metadata: { name: 'build-pod' } },
			log: '2026-06-17T10:00:00Z building'
		});
		await captureActiveBuildLogs(kc);
		expect(insertedRows).toHaveLength(0);
	});
});
