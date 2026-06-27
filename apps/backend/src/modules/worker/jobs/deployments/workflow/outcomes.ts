import { and, eq } from 'drizzle-orm';
import { db, deployments, type Deployment } from '@kubwave/db';
import type { ReconcileResult } from '../deployers/types.js';
import { finalize, insertLogs, logEntry, phaseEntry } from '../logs.js';

export async function applyReconcileResult(row: Deployment, result: ReconcileResult): Promise<void> {
	const events = result.events ?? [];

	if (result.state === 'ready') {
		await finalize(row.id, 'deploying', { status: 'succeeded', phase: 'done', lastError: null }, [
			...events,
			logEntry('info', 'succeeded', 'Deployment succeeded')
		]);
		return;
	}

	if (result.state === 'failed') {
		await finalize(row.id, 'deploying', { status: 'failed', phase: 'failed', lastError: result.error }, [
			...events,
			logEntry('error', 'failed', result.error)
		]);
		return;
	}

	// Log the phase line only on a phase change so a multi-tick rollout doesn't append "rolling-out" every tick; deployer events still write.
	const phaseChanged = result.phase !== row.phase;
	const entries = [...events, ...(phaseChanged ? [phaseEntry(result.phase)] : [])];
	const updated = await db
		.update(deployments)
		.set({ phase: result.phase })
		.where(and(eq(deployments.id, row.id), eq(deployments.status, 'deploying')))
		.returning({ id: deployments.id });
	if (updated.length > 0) await insertLogs(row.id, entries);
}
