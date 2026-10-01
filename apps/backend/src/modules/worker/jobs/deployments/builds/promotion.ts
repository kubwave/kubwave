import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { getMaxConcurrentDeployments } from '../concurrency.js';
import { RECONCILE_IN_FLIGHT_STATUSES } from '../types.js';

export const DEPLOYMENT_CAPACITY_LOCK = 73162412;

export async function reserveBuildDeployment(deploymentId: string): Promise<boolean> {
	const { db, deployments } = await import('@kubwave/db');
	const max = await getMaxConcurrentDeployments();
	return db.transaction(async tx => {
		await tx.execute(sql`select pg_advisory_xact_lock(${DEPLOYMENT_CAPACITY_LOCK})`);
		const [deployment] = await tx.select().from(deployments).where(eq(deployments.id, deploymentId)).for('update');
		if (deployment?.status !== 'deploying') return false;
		if (!['building', 'build-queued'].includes(deployment.phase ?? '')) return true;
		const [inflight] = await tx
			.select({ value: count() })
			.from(deployments)
			.where(
				and(
					inArray(deployments.status, [...RECONCILE_IN_FLIGHT_STATUSES]),
					sql`coalesce(${deployments.phase}, '') not in ('building', 'build-queued')`
				)
			);
		if (Number(inflight?.value ?? 0) >= max) return false;
		await tx.update(deployments).set({ phase: 'applying' }).where(eq(deployments.id, deploymentId));
		return true;
	});
}
