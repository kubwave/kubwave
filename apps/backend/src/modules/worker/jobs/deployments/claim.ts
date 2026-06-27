import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { db, deploymentLogs, deployments, type Deployment } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { deploymentLogRows, logEntry } from './logs.js';
import { computeClaimLimit, getMaxConcurrentDeployments } from './concurrency.js';
import { RECONCILE_IN_FLIGHT_STATUSES } from './types.js';

// How many queued deployments to claim per tick: bounds per-tick work, not total throughput (each claimed row is reconciled the same tick).
export const CLAIM_BATCH = 5;

// Atomically claim queued rows via FOR UPDATE SKIP LOCKED (peers skip them); at most one in-flight deploy per service.
// Concurrency cap is exact for a single worker, a converging soft ceiling under multiple replicas.
export async function claimPending(): Promise<Deployment[]> {
	const max = await getMaxConcurrentDeployments();
	return db.transaction(async tx => {
		const [inflight] = await tx
			.select({ value: count() })
			.from(deployments)
			.where(inArray(deployments.status, [...RECONCILE_IN_FLIGHT_STATUSES]));
		const limit = computeClaimLimit(max, Number(inflight?.value ?? 0), CLAIM_BATCH);
		if (limit === 0) return [];

		const rows = await tx
			.select()
			.from(deployments)
			.where(
				and(
					eq(deployments.status, 'pending'),
					sql`not exists (select 1 from ${deployments} d2 where d2.service_id = ${deployments.serviceId} and d2.status in ('deploying', 'canceling'))`
				)
			)
			.orderBy(deployments.createdAt)
			.limit(limit)
			.for('update', { skipLocked: true });

		const now = new Date();
		for (const row of rows) {
			await tx
				.update(deployments)
				.set({
					status: 'deploying',
					phase: 'applying',
					lockedBy: env.workerId,
					lockedAt: now,
					startedAt: row.startedAt ?? now,
					attempts: row.attempts + 1
				})
				.where(eq(deployments.id, row.id));
			await tx
				.insert(deploymentLogs)
				.values(deploymentLogRows(row.id, [logEntry('info', 'claimed', `Claimed by worker ${env.workerId} - applying manifests`)]));
		}
		return rows;
	});
}
