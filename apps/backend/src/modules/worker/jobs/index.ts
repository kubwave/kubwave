import { createIntervalJob, type IntervalJob } from '../../../shared/scheduler/interval-job.js';
import { env } from '../../../shared/config/worker-env.js';
import { BUILD_LOG_CAPTURE_INTERVAL_MS, runBuildLogCapture } from './deployments/builds/logs.js';
import { runDeploymentReconcile } from './deployments/job.js';
import { runGitPoll } from './git-poll/job.js';
import { runPlatformReconcile } from './platform/job.js';
import { runVolumeAutoscaling } from './platform/volume-autoscaling/job.js';
import { runPrDiscovery } from './pr-preview/job.js';
import { garbageCollectRegistry } from './registry/gc.js';
import { pruneRegistryImages } from './registry/prune.js';
import { runUpdateRunReconcile, UPDATE_RUN_RECONCILE_INTERVAL_MS } from './updates/job.js';
import { runTemplateCatalogPoll } from './template-catalog/job.js';
import { POLL_INTERVAL_MS, runVersionPoll } from './version/job.js';

interface WorkerJobDefinition {
	name: string;
	intervalMs: () => number;
	task: () => Promise<void>;
	enabled?: () => boolean;
	runImmediately?: boolean;
	unref?: boolean;
}

const workerJobDefinitions: WorkerJobDefinition[] = [
	{
		name: 'reconcile',
		intervalMs: () => env.reconcileIntervalMs,
		task: runDeploymentReconcile,
		unref: false
	},
	{
		name: 'build-log-capture',
		intervalMs: () => BUILD_LOG_CAPTURE_INTERVAL_MS,
		task: runBuildLogCapture,
		enabled: () => Boolean(env.registryEndpoint),
		runImmediately: true
	},
	{
		name: 'platform',
		intervalMs: () => env.reconcileIntervalMs,
		task: runPlatformReconcile
	},
	{
		name: 'update-reconciler',
		intervalMs: () => UPDATE_RUN_RECONCILE_INTERVAL_MS,
		task: runUpdateRunReconcile,
		runImmediately: true
	},
	{
		name: 'version-poller',
		intervalMs: () => POLL_INTERVAL_MS,
		task: runVersionPoll
	},
	{
		name: 'template-catalog-poller',
		intervalMs: () => env.templateCatalogPollIntervalMs,
		task: runTemplateCatalogPoll,
		enabled: () => env.templateCatalogPollEnabled,
		runImmediately: true
	},
	{
		name: 'git-poll',
		intervalMs: () => env.gitPollIntervalMs,
		task: runGitPoll
	},
	{
		name: 'pr-discovery',
		intervalMs: () => env.prDiscoveryIntervalMs,
		task: runPrDiscovery
	},
	{
		name: 'registry-prune',
		intervalMs: () => env.registryPruneIntervalMs,
		task: () => pruneRegistryImages().then(() => undefined),
		enabled: () => Boolean(env.registryEndpoint)
	},
	{
		name: 'registry-gc',
		intervalMs: () => env.registryGcIntervalMs,
		task: () => garbageCollectRegistry().then(() => undefined),
		enabled: () => env.registryGcEnabled && Boolean(env.registryEndpoint)
	},
	{
		name: 'volume-autoscaling',
		intervalMs: () => env.volumeAutoscalingIntervalMs,
		task: () => runVolumeAutoscaling()
	}
];

export function createWorkerJobs(): IntervalJob[] {
	return workerJobDefinitions.map(({ name, intervalMs, task, enabled, runImmediately, unref }) =>
		createIntervalJob({
			name,
			intervalMs: intervalMs(),
			task,
			enabled: enabled?.(),
			runImmediately,
			unref
		})
	);
}
