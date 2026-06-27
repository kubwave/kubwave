import { and, eq } from 'drizzle-orm';
import { db, deploymentLogs, deployments, type DeploymentLogEntry, type DeploymentLogLevel, type DeploymentStatus } from '@kubwave/db';

export function logEntry(level: DeploymentLogLevel, step: string, message: string): DeploymentLogEntry {
	return { ts: new Date().toISOString(), level, step, message };
}

export function deploymentLogRows(deploymentId: string, entries: DeploymentLogEntry[]) {
	return entries.map(entry => ({
		deploymentId,
		kind: 'event' as const,
		ts: new Date(entry.ts),
		level: entry.level,
		step: entry.step,
		message: entry.message
	}));
}

export async function insertLogs(deploymentId: string, entries: DeploymentLogEntry[]): Promise<void> {
	if (entries.length === 0) return;
	await db.insert(deploymentLogs).values(deploymentLogRows(deploymentId, entries));
}

// Map a deployer phase string to a log entry; an `error: <reason>` phase (still progressing, not failed) surfaces as a warning, everything else as info.
export function phaseEntry(phase: string): DeploymentLogEntry {
	if (phase.startsWith('error:')) return logEntry('warn', 'error', phase.slice(6).trim());
	if (phase === 'applying') return logEntry('info', 'applying', 'Applying manifests…');
	if (phase === 'rolling-out') return logEntry('info', 'rolling-out', 'Waiting for rollout…');
	if (phase === 'building') return logEntry('info', 'building', 'Building image…');
	if (phase === 'pushing') return logEntry('info', 'pushing', 'Pushing image to the registry…');
	if (phase === 'image-ready') return logEntry('info', 'image-ready', 'Image built — applying manifests…');
	return logEntry('info', phase, phase);
}

// Finalize only if the row is still in expectedStatus (guards against a racing takeover/supersede). Here, not in the reconcilers, to avoid an import cycle.
export async function finalize(
	id: string,
	expectedStatus: DeploymentStatus,
	fields: { status: DeploymentStatus; phase: string; lastError: string | null; rollbackAttempts?: number },
	entries: DeploymentLogEntry[]
): Promise<void> {
	const updated = await db
		.update(deployments)
		.set({ ...fields, finishedAt: new Date() })
		.where(and(eq(deployments.id, id), eq(deployments.status, expectedStatus)))
		.returning({ id: deployments.id });
	if (updated.length > 0) await insertLogs(id, entries);
}
