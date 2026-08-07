import { and, eq, sql } from 'drizzle-orm';
import { db, deploymentLogs, deployments, type ServiceConfig, type ServiceType } from '@kubwave/db';
import { deploymentLogRows, logEntry } from '../deployments/logs.js';

export interface WatchSource {
	id: string;
	type: ServiceType;
	config: ServiceConfig;
}

// Pin the observed digest into the snapshot so the rollout is deterministic; the service row keeps the mutable tag so watching continues.
function pinDigest(config: ServiceConfig, digest: string): ServiceConfig {
	return { ...config, digest } as ServiceConfig;
}

// Mirrors enqueueAutoDeployment (advisory lock + supersede pending); no user context (trigger='auto').
export async function enqueueWatchDeployment(service: WatchSource, digest: string): Promise<void> {
	await db.transaction(async tx => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deploy:${service.id}`}))`);
		await tx
			.update(deployments)
			.set({ status: 'superseded', finishedAt: new Date() })
			.where(and(eq(deployments.serviceId, service.id), eq(deployments.status, 'pending')));
		const [row] = await tx
			.insert(deployments)
			.values({
				serviceId: service.id,
				type: service.type,
				config: pinDigest(service.config, digest),
				status: 'pending',
				trigger: 'auto',
				triggeredByUserId: null
			})
			.returning({ id: deployments.id });
		if (row) {
			await tx.insert(deploymentLogs).values(deploymentLogRows(row.id, [logEntry('info', 'queued', `Tag watch: new digest ${digest.slice(0, 12)}`)]));
		}
	});
}
