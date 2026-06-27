import { isNotNull } from 'drizzle-orm';
import * as k8s from '@kubernetes/client-node';
import { db, updateRuns } from '@kubwave/db';
import { getKubeConfig, isNotFound } from '@kubwave/kube';
import { env } from '../../../../shared/config/worker-env.js';

// Label on every self-update Job (job-template.yaml); used to list Jobs for the ghost-reap step.
const UPDATER_JOB_LABEL_SELECTOR = 'app.kubernetes.io/component=updater';

// Ghost-reap: delete update Jobs with no DB row. Rows are kept forever (audit), so a Job only
// outlives its row when createUpdateJob raced (Job created, DB link failed) or a row is stuck.
export async function reapOrphanUpdateJobs(): Promise<void> {
	const knownJobNames = await db.select({ jobName: updateRuns.jobName }).from(updateRuns).where(isNotNull(updateRuns.jobName));

	const known = new Set<string>();
	for (const row of knownJobNames) {
		if (row.jobName) {
			known.add(row.jobName);
		}
	}

	const kc = getKubeConfig();
	const batchApi = kc.makeApiClient(k8s.BatchV1Api);
	const list = await batchApi.listNamespacedJob({
		namespace: env.podNamespace,
		labelSelector: UPDATER_JOB_LABEL_SELECTOR
	});

	let reaped = 0;
	for (const job of list.items) {
		const name = job.metadata?.name;
		if (!name) {
			continue;
		}
		if (known.has(name)) {
			continue;
		}
		await deleteUpdateJob(name);
		reaped++;
	}

	if (reaped > 0) {
		console.warn(`[update-reconciler] reaped ${reaped} orphan update job(s) in ${env.podNamespace}`);
	}
}

async function deleteUpdateJob(jobName: string): Promise<void> {
	const kc = getKubeConfig();
	const batchApi = kc.makeApiClient(k8s.BatchV1Api);

	try {
		await batchApi.deleteNamespacedJob({ name: jobName, namespace: env.podNamespace, propagationPolicy: 'Background' });
	} catch (err) {
		if (isNotFound(err)) {
			return;
		}
		throw err;
	}
}
