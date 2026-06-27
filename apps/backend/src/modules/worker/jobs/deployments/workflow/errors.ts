import { and, eq } from 'drizzle-orm';
import { db, deployments, type Deployment, type DeploymentStatus } from '@kubwave/db';
import { errorMessage } from '../../../../../shared/worker-common/errors.js';
import { insertLogs, logEntry } from '../logs.js';

export async function handleReconcileError(row: Deployment, err: unknown): Promise<void> {
	// Transient (API blip, etc.): leave the active row in place so the next tick retries.
	const message = errorMessage(err);
	console.warn(`[reconcile] reconcile of deployment ${row.id} failed (will retry):`, message);

	// Log once per distinct message so repeated identical blips don't spam the step-log.
	const changed = message !== row.lastError;
	const activeStatus: DeploymentStatus = row.status === 'canceling' ? 'canceling' : 'deploying';
	const updated = await db
		.update(deployments)
		.set({ lastError: message })
		.where(and(eq(deployments.id, row.id), eq(deployments.status, activeStatus)))
		.returning({ id: deployments.id });
	if (changed && updated.length > 0) await insertLogs(row.id, [logEntry('error', 'error', message)]);
}
