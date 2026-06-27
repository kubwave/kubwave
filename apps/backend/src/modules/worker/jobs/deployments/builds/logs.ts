import { createHash } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { BatchV1Api, CoreV1Api } from '@kubernetes/client-node';
import type { KubeConfig, V1Job } from '@kubernetes/client-node';
import { db, deploymentLogs, deployments } from '@kubwave/db';
import { getKubeConfig } from '@kubwave/kube';
import { env } from '../../../../../shared/config/worker-env.js';
import { BUILD_ACTIVE_STATUSES } from '../types.js';
import { BUILDER_LABEL_SELECTOR, LABEL_DEPLOYMENT_ID, readBuildPod } from './service.js';

export const BUILD_LOG_CAPTURE_INTERVAL_MS = 2000;

function buildContainerNames(job: V1Job): string[] {
	return [...(job.spec?.template?.spec?.initContainers ?? []), ...(job.spec?.template?.spec?.containers ?? [])]
		.map(container => container.name)
		.filter(name => name.length > 0);
}

function hashLine(line: string): string {
	return createHash('sha256').update(line).digest('hex').slice(0, 32);
}

export function parseTimestampedBuildLog(raw: string): Array<{ sourceTs: Date; message: string; lineHash: string }> {
	const lines = raw.split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines.map((line, index) => {
		const space = line.indexOf(' ');
		if (space > 0) {
			const maybeTs = line.slice(0, space);
			const ms = Date.parse(maybeTs);
			if (Number.isFinite(ms)) {
				const message = line.slice(space + 1);
				return { sourceTs: new Date(ms), message, lineHash: hashLine(`${index}\0${message}`) };
			}
		}
		return { sourceTs: new Date(0), message: line, lineHash: hashLine(`${index}\0${line}`) };
	});
}

export async function captureBuildLogs(args: {
	api: CoreV1Api;
	namespace: string;
	jobName: string;
	deploymentId: string;
	containers: string[];
}): Promise<void> {
	try {
		const pod = await readBuildPod(args.api, args.namespace, args.jobName);
		const podName = pod?.metadata?.name;
		if (!podName) return;

		for (const container of args.containers) {
			try {
				const raw = await args.api.readNamespacedPodLog({ name: podName, namespace: args.namespace, container, timestamps: true });
				const lines = parseTimestampedBuildLog(typeof raw === 'string' ? raw : String(raw));
				if (lines.length === 0) continue;
				await db
					.insert(deploymentLogs)
					.values(
						lines.map(line => ({
							deploymentId: args.deploymentId,
							kind: 'build-output' as const,
							ts: new Date(),
							level: 'info' as const,
							step: 'build-output',
							message: line.message,
							containerName: container,
							sourceTs: line.sourceTs,
							lineHash: line.lineHash
						}))
					)
					.onConflictDoNothing({
						target: [deploymentLogs.deploymentId, deploymentLogs.containerName, deploymentLogs.sourceTs, deploymentLogs.lineHash]
					});
			} catch {
				// Pod or container logs may not exist yet; the next reconcile tick retries.
			}
		}
	} catch {
		// Build-log capture is observational and must never affect deployment progress.
	}
}

export async function captureActiveBuildLogs(kc: KubeConfig): Promise<void> {
	const namespace = env.podNamespace;
	const batchApi = kc.makeApiClient(BatchV1Api);
	const coreApi = kc.makeApiClient(CoreV1Api);
	const jobs = await batchApi.listNamespacedJob({ namespace, labelSelector: BUILDER_LABEL_SELECTOR });
	if (jobs.items.length === 0) return;

	const deploymentIds = Array.from(
		new Set(jobs.items.map(job => job.metadata?.labels?.[LABEL_DEPLOYMENT_ID]).filter((id): id is string => Boolean(id)))
	);
	if (deploymentIds.length === 0) return;

	const rows = await db.select({ id: deployments.id, status: deployments.status }).from(deployments).where(inArray(deployments.id, deploymentIds));
	const active = new Set(rows.filter(row => (BUILD_ACTIVE_STATUSES as readonly string[]).includes(row.status)).map(row => row.id));

	for (const job of jobs.items) {
		const deploymentId = job.metadata?.labels?.[LABEL_DEPLOYMENT_ID];
		const jobName = job.metadata?.name;
		if (!deploymentId || !jobName || !active.has(deploymentId)) continue;
		await captureBuildLogs({ api: coreApi, namespace, jobName, deploymentId, containers: buildContainerNames(job) });
	}
}

export async function runBuildLogCapture(): Promise<void> {
	await captureActiveBuildLogs(getKubeConfig());
}
