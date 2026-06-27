import { and, eq, inArray } from 'drizzle-orm';
import * as k8s from '@kubernetes/client-node';
import { db, updateRuns } from '@kubwave/db';
import type { UpdateRun } from '@kubwave/db';
import { getKubeConfig, isNotFound } from '@kubwave/kube';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { getUpdateRunReconcileOutcome } from './outcome.js';
import { currentUpdatePhase, describeFailedContainer } from './logs.js';
import { ACTIVE_UPDATE_RUN_STATUSES } from './types.js';

export async function reconcileActiveUpdateRuns(): Promise<void> {
	const activeRuns = await db
		.select()
		.from(updateRuns)
		.where(inArray(updateRuns.status, [...ACTIVE_UPDATE_RUN_STATUSES]));
	for (const run of activeRuns) {
		await safelyReconcileUpdateRun(run);
	}
}

async function safelyReconcileUpdateRun(run: UpdateRun): Promise<void> {
	try {
		await reconcileUpdateRun(run);
	} catch (err) {
		console.warn(`[update-reconciler] failed to reconcile update run ${run.id}:`, errorMessage(err));
	}
}

async function reconcileUpdateRun(run: UpdateRun): Promise<void> {
	const job = run.jobName ? await readUpdateJob(run.jobName) : null;
	const pod = run.jobName ? await readUpdatePod(run.jobName) : null;
	const outcome = getUpdateRunReconcileOutcome(run, job);

	if (!outcome) {
		const phase = pod ? currentUpdatePhase(pod) : null;
		if (phase && phase !== run.phase) {
			await db
				.update(updateRuns)
				.set({ phase })
				.where(and(eq(updateRuns.id, run.id), inArray(updateRuns.status, [...ACTIVE_UPDATE_RUN_STATUSES])));
		}
		return;
	}

	if (outcome.status === 'succeeded') {
		await db
			.update(updateRuns)
			.set({ status: 'succeeded', phase: 'done', lastError: null, finishedAt: new Date() })
			.where(and(eq(updateRuns.id, run.id), inArray(updateRuns.status, [...ACTIVE_UPDATE_RUN_STATUSES])));
		return;
	}

	const containerFailure = pod ? describeFailedContainer(pod) : null;
	await db
		.update(updateRuns)
		.set({
			status: outcome.status,
			lastError: containerFailure?.message ?? outcome.lastError,
			phase: containerFailure?.phase ?? run.phase,
			finishedAt: new Date()
		})
		.where(and(eq(updateRuns.id, run.id), inArray(updateRuns.status, [...ACTIVE_UPDATE_RUN_STATUSES])));
}

async function readUpdateJob(jobName: string): Promise<k8s.V1Job | null> {
	const kc = getKubeConfig();
	const batchApi = kc.makeApiClient(k8s.BatchV1Api);

	try {
		return await batchApi.readNamespacedJob({ name: jobName, namespace: env.podNamespace });
	} catch (err) {
		if (isNotFound(err)) {
			return null;
		}
		throw err;
	}
}

async function readUpdatePod(jobName: string): Promise<k8s.V1Pod | null> {
	const kc = getKubeConfig();
	const coreApi = kc.makeApiClient(k8s.CoreV1Api);
	const podList = await coreApi.listNamespacedPod({ namespace: env.podNamespace, labelSelector: `job-name=${jobName}` });
	return podList.items[0] ?? null;
}
