import { and, eq } from 'drizzle-orm';
import { db, environments } from '@kubwave/db';

// Delete a preview environment row (cascades to services + deployments; gcOrphans reclaims the
// namespace). Guarded to kind='preview' so a logic error can't drop a persistent environment.
export async function teardownPreview(previewEnvironmentId: string): Promise<void> {
	await db.delete(environments).where(and(eq(environments.id, previewEnvironmentId), eq(environments.kind, 'preview')));
}
