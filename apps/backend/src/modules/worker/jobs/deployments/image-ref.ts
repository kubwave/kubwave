import { and, eq, isNull } from 'drizzle-orm';

// Write-once: a deployment's image ref is decided on its first reconcile tick, and every later tick reuses it.
// The db import stays lazy so pulling this in never forces a connection at module load.
export async function persistDeploymentImageRef(deploymentId: string, imageRef: string): Promise<void> {
	const { db, deployments } = await import('@kubwave/db');
	await db
		.update(deployments)
		.set({ imageRef })
		.where(and(eq(deployments.id, deploymentId), isNull(deployments.imageRef)));
}
