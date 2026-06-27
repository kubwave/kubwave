import { and, eq, isNull } from 'drizzle-orm';
import * as k8s from '@kubernetes/client-node';
import { db, updateRuns } from '@kubwave/db';
import type { UpdateRun } from '@kubwave/db';
import { getKubeConfig, UPDATE_JOB_TEMPLATE_CONFIGMAP_NAME } from '@kubwave/kube';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { resolveUpdateImageRegistry } from './registry.js';

// Create the K8s Job for every `pending` run without one yet. The API has already validated the
// target version, ruled out concurrent/no-op runs, and inserted the row; the worker materializes it.
export async function createJobsForPendingRuns(): Promise<void> {
	const pending = await db
		.select()
		.from(updateRuns)
		.where(and(eq(updateRuns.status, 'pending'), isNull(updateRuns.jobName)));

	for (const run of pending) {
		await createUpdateJob(run);
	}
}

export async function createUpdateJob(run: UpdateRun): Promise<void> {
	try {
		const kc = getKubeConfig();
		const coreApi = kc.makeApiClient(k8s.CoreV1Api);
		const batchApi = kc.makeApiClient(k8s.BatchV1Api);

		const namespace = env.podNamespace;
		const configMap = await coreApi.readNamespacedConfigMap({ name: UPDATE_JOB_TEMPLATE_CONFIGMAP_NAME, namespace });
		const templateYaml = configMap.data?.['job.yaml'];

		if (!templateYaml) {
			throw new Error('update-job-template ConfigMap missing job.yaml key');
		}

		const updateImageRegistry = await resolveUpdateImageRegistry(kc, coreApi, namespace);
		const targetImage = `${updateImageRegistry}/cli:${run.toVersion}`;
		const jobYaml = templateYaml
			.replace(/\{\{RUN_ID\}\}/g, run.id)
			.replace(/\{\{TARGET_VERSION\}\}/g, run.toVersion)
			.replace(/\{\{TARGET_IMAGE\}\}/g, targetImage);

		const jobSpec = k8s.loadYaml<k8s.V1Job>(jobYaml);
		const jobName = jobSpec.metadata?.name ?? `update-${run.id}`;

		await batchApi.createNamespacedJob({ namespace, body: jobSpec });

		// Guard the write on still-`pending` so we never resurrect a run the API or a prune moved on.
		await db
			.update(updateRuns)
			.set({ jobName, startedAt: new Date(), status: 'running' })
			.where(and(eq(updateRuns.id, run.id), eq(updateRuns.status, 'pending')));
	} catch (err) {
		const errMsg = errorMessage(err);
		await db
			.update(updateRuns)
			.set({ status: 'failed', lastError: errMsg, finishedAt: new Date() })
			.where(and(eq(updateRuns.id, run.id), eq(updateRuns.status, 'pending')));
	}
}
