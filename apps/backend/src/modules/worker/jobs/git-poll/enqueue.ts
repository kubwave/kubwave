import { and, eq, sql } from 'drizzle-orm';
import { db, deploymentLogs, deployments, type ServiceConfig, type ServiceType } from '@kubwave/db';
import { deploymentLogRows, logEntry } from '../deployments/logs.js';

export interface AutoDeploySource {
	id: string;
	type: ServiceType;
	config: ServiceConfig;
}

// Pin resolved HEAD into the snapshot's commit (build checks out that SHA); the service config keeps commit empty so it still tracks the branch.
function pinCommit(config: ServiceConfig, commit: string): ServiceConfig {
	return { ...config, commit } as ServiceConfig;
}

// Mirrors enqueueDeployment (advisory lock + supersede pending) to respect the single-pending-per-service index; no user context (trigger='auto').
export async function enqueueAutoDeployment(service: AutoDeploySource, commit: string): Promise<void> {
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
				config: pinCommit(service.config, commit),
				status: 'pending',
				trigger: 'auto',
				triggeredByUserId: null
			})
			.returning({ id: deployments.id });
		if (row) {
			await tx
				.insert(deploymentLogs)
				.values(deploymentLogRows(row.id, [logEntry('info', 'queued', `Auto-deploy: new commit ${commit.slice(0, 7)}`)]));
		}
	});
}
