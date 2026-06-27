import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { IntervalJobOptions } from '~/shared/scheduler/interval-job';

const fakeEnv = {
	reconcileIntervalMs: 5000,
	registryEndpoint: 'registry.local:5000',
	gitPollIntervalMs: 11_000,
	prDiscoveryIntervalMs: 12_000,
	registryPruneIntervalMs: 13_000,
	registryGcIntervalMs: 14_000,
	registryGcEnabled: true,
	volumeAutoscalingIntervalMs: 15_000,
	templateCatalogPollIntervalMs: 1_800_000
};
const createdOptions: IntervalJobOptions[] = [];

mock.module('~/shared/config/worker-env', () => ({ env: fakeEnv }));
mock.module('~/shared/scheduler/interval-job', () => ({
	createIntervalJob: (opts: IntervalJobOptions) => {
		createdOptions.push(opts);
		return { stop() {} };
	}
}));
mock.module('~/modules/worker/jobs/deployments/builds/logs', () => ({
	BUILD_LOG_CAPTURE_INTERVAL_MS: 1234,
	runBuildLogCapture: async () => {}
}));
mock.module('~/modules/worker/jobs/deployments/job', () => ({ runDeploymentReconcile: async () => {} }));
mock.module('~/modules/worker/jobs/git-poll/job', () => ({ runGitPoll: async () => {} }));
mock.module('~/modules/worker/jobs/platform/job', () => ({ runPlatformReconcile: async () => {} }));
mock.module('~/modules/worker/jobs/platform/volume-autoscaling/job', () => ({ runVolumeAutoscaling: async () => {} }));
mock.module('~/modules/worker/jobs/pr-preview/job', () => ({ runPrDiscovery: async () => {} }));
mock.module('~/modules/worker/jobs/registry/gc', () => ({ garbageCollectRegistry: async () => {} }));
mock.module('~/modules/worker/jobs/registry/prune', () => ({ pruneRegistryImages: async () => {} }));
mock.module('~/modules/worker/jobs/updates/job', () => ({
	UPDATE_RUN_RECONCILE_INTERVAL_MS: 15_000,
	runUpdateRunReconcile: async () => {}
}));
mock.module('~/modules/worker/jobs/version/job', () => ({
	POLL_INTERVAL_MS: 6 * 60 * 60 * 1000,
	runVersionPoll: async () => {}
}));
mock.module('~/modules/worker/jobs/template-catalog/job', () => ({
	runTemplateCatalogPoll: async () => {}
}));

const { createWorkerJobs } = await import('~/modules/worker/jobs');

afterEach(() => {
	createdOptions.length = 0;
	fakeEnv.registryEndpoint = 'registry.local:5000';
	fakeEnv.registryGcEnabled = true;
});

describe('createWorkerJobs', () => {
	test('registers every worker job with the expected interval and flags', () => {
		const jobs = createWorkerJobs();
		const byName = new Map(createdOptions.map(opts => [opts.name, opts]));

		expect(jobs).toHaveLength(11);
		expect([...byName.keys()]).toEqual([
			'reconcile',
			'build-log-capture',
			'platform',
			'update-reconciler',
			'version-poller',
			'template-catalog-poller',
			'git-poll',
			'pr-discovery',
			'registry-prune',
			'registry-gc',
			'volume-autoscaling'
		]);
		expect(byName.get('reconcile')).toMatchObject({ intervalMs: 5000, unref: false });
		expect(byName.get('build-log-capture')).toMatchObject({ intervalMs: 1234, enabled: true, runImmediately: true });
		expect(byName.get('platform')).toMatchObject({ intervalMs: 5000 });
		expect(byName.get('update-reconciler')).toMatchObject({ intervalMs: 15_000, runImmediately: true });
		expect(byName.get('version-poller')).toMatchObject({ intervalMs: 6 * 60 * 60 * 1000 });
		expect(byName.get('template-catalog-poller')).toMatchObject({ intervalMs: 1_800_000, runImmediately: true });
		expect(byName.get('git-poll')).toMatchObject({ intervalMs: 11_000 });
		expect(byName.get('pr-discovery')).toMatchObject({ intervalMs: 12_000 });
		expect(byName.get('registry-prune')).toMatchObject({ intervalMs: 13_000, enabled: true });
		expect(byName.get('registry-gc')).toMatchObject({ intervalMs: 14_000, enabled: true });
		expect(byName.get('volume-autoscaling')).toMatchObject({ intervalMs: 15_000 });
	});

	test('disables registry jobs when registry settings are unavailable', () => {
		fakeEnv.registryEndpoint = '';
		fakeEnv.registryGcEnabled = false;

		createWorkerJobs();
		const byName = new Map(createdOptions.map(opts => [opts.name, opts]));

		expect(byName.get('build-log-capture')).toMatchObject({ enabled: false });
		expect(byName.get('registry-prune')).toMatchObject({ enabled: false });
		expect(byName.get('registry-gc')).toMatchObject({ enabled: false });
	});
});
