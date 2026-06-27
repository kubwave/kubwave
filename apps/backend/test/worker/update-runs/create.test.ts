import { afterEach, describe, expect, mock, test } from 'bun:test';
import { BatchV1Api, CoreV1Api, type KubeConfig } from '@kubernetes/client-node';

// createUpdateJob: read template ConfigMap → resolve registry → render → create Job → flip row to running; any error fails the row.

let pendingRuns: unknown[] = [];
const updates: Array<{ set: Record<string, unknown> }> = [];

let configMapData: Record<string, string> | undefined = { 'job.yaml': '' };
let configMapThrows: unknown = null;
const createdJobs: unknown[] = [];
let createJobThrows: unknown = null;
let registryThrows: unknown = null;

mock.module('~/shared/config/worker-env', () => ({ env: { podNamespace: 'kubwave' } }));

const coreApi = {
	readNamespacedConfigMap: async () => {
		if (configMapThrows) throw configMapThrows;
		return { data: configMapData };
	}
};
const batchApi = {
	createNamespacedJob: async ({ body }: { body: unknown }) => {
		if (createJobThrows) throw createJobThrows;
		createdJobs.push(body);
	}
};
const fakeKc = {
	makeApiClient: (klass: unknown) => (klass === CoreV1Api ? coreApi : klass === BatchV1Api ? batchApi : {})
} as unknown as KubeConfig;

mock.module('@kubwave/kube', () => ({
	getKubeConfig: () => fakeKc,
	UPDATE_JOB_TEMPLATE_CONFIGMAP_NAME: 'update-job-template'
}));

mock.module('~/modules/worker/jobs/updates/registry', () => ({
	resolveUpdateImageRegistry: async () => {
		if (registryThrows) throw registryThrows;
		return 'ghcr.io/acme';
	}
}));

mock.module('@kubwave/db', () => ({
	updateRuns: {},
	db: {
		select: () => ({ from: () => ({ where: async () => pendingRuns }) }),
		update: () => ({
			set: (set: Record<string, unknown>) => {
				updates.push({ set });
				return { where: async () => undefined };
			}
		})
	}
}));

const { createJobsForPendingRuns, createUpdateJob } = await import('~/modules/worker/jobs/updates/create');

const TEMPLATE = [
	'apiVersion: batch/v1',
	'kind: Job',
	'metadata:',
	'  name: update-{{RUN_ID}}',
	'spec:',
	'  template:',
	'    spec:',
	'      containers:',
	'        - name: finalize',
	'          image: "{{TARGET_IMAGE}}"',
	'          env:',
	'            - name: TARGET_VERSION',
	'              value: "{{TARGET_VERSION}}"'
].join('\n');

function run(overrides: Record<string, unknown> = {}) {
	return { id: 'run-1', toVersion: '0.2.0', status: 'pending', jobName: null, createdAt: new Date(), ...overrides } as never;
}

afterEach(() => {
	pendingRuns = [];
	updates.length = 0;
	createdJobs.length = 0;
	configMapData = { 'job.yaml': TEMPLATE };
	configMapThrows = null;
	createJobThrows = null;
	registryThrows = null;
});

describe('createUpdateJob', () => {
	test('renders the template, creates the Job, and flips the run to running', async () => {
		configMapData = { 'job.yaml': TEMPLATE };
		await createUpdateJob(run());

		expect(createdJobs).toHaveLength(1);
		const job = createdJobs[0] as {
			metadata?: { name?: string };
			spec?: { template?: { spec?: { containers?: Array<{ image?: string; env?: Array<{ value?: string }> }> } } };
		};
		expect(job.metadata?.name).toBe('update-run-1');
		expect(job.spec?.template?.spec?.containers?.[0]?.image).toBe('ghcr.io/acme/cli:0.2.0');
		expect(job.spec?.template?.spec?.containers?.[0]?.env?.[0]?.value).toBe('0.2.0');

		expect(updates).toHaveLength(1);
		expect(updates[0]!.set).toMatchObject({ jobName: 'update-run-1', status: 'running' });
		expect(updates[0]!.set.startedAt).toBeInstanceOf(Date);
	});

	test('missing job.yaml key → fails the run without creating a Job', async () => {
		configMapData = {}; // no job.yaml
		await createUpdateJob(run());
		expect(createdJobs).toHaveLength(0);
		expect(updates).toHaveLength(1);
		expect(updates[0]!.set).toMatchObject({ status: 'failed', lastError: 'update-job-template ConfigMap missing job.yaml key' });
		expect(updates[0]!.set.finishedAt).toBeInstanceOf(Date);
	});

	test('a ConfigMap read error → fails the run with the error message', async () => {
		configMapThrows = new Error('configmaps "update-job-template" not found');
		await createUpdateJob(run());
		expect(createdJobs).toHaveLength(0);
		expect(updates[0]!.set).toMatchObject({ status: 'failed', lastError: 'configmaps "update-job-template" not found' });
	});

	test('a registry-resolution error → fails the run', async () => {
		registryThrows = new Error('Could not determine update image registry');
		await createUpdateJob(run());
		expect(createdJobs).toHaveLength(0);
		expect(updates[0]!.set).toMatchObject({ status: 'failed', lastError: 'Could not determine update image registry' });
	});

	test('a Job-create error (e.g. 409 AlreadyExists) → fails the run', async () => {
		createJobThrows = { code: 409, message: 'jobs.batch "update-run-1" already exists' };
		await createUpdateJob(run());
		// stringified non-Error object
		expect(updates[0]!.set.status).toBe('failed');
	});

	test('falls back to update-<id> when the template omits metadata.name', async () => {
		configMapData = { 'job.yaml': ['apiVersion: batch/v1', 'kind: Job', 'spec: {}'].join('\n') };
		await createUpdateJob(run());
		expect(updates[0]!.set).toMatchObject({ jobName: 'update-run-1', status: 'running' });
	});
});

describe('createJobsForPendingRuns', () => {
	test('creates a Job for every pending run', async () => {
		pendingRuns = [run(), { id: 'run-2', toVersion: '0.3.0', status: 'pending', jobName: null, createdAt: new Date() }];
		configMapData = { 'job.yaml': TEMPLATE };
		await createJobsForPendingRuns();
		expect(createdJobs).toHaveLength(2);
		expect(updates.filter(u => u.set.status === 'running')).toHaveLength(2);
	});

	test('no pending runs → no Jobs, no writes', async () => {
		pendingRuns = [];
		await createJobsForPendingRuns();
		expect(createdJobs).toHaveLength(0);
		expect(updates).toHaveLength(0);
	});
});
