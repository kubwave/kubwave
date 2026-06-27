import { inArray } from 'drizzle-orm';
import { db, services, type Deployment } from '@kubwave/db';

export interface ServiceMeta {
	environmentId: string;
	name: string;
}

// Resolve each deployment's owning environment (serviceId -> environmentId) in one query; a missing entry means the service
// was deleted mid-tick (FK cascade in flight), so that row is skipped.
export async function resolveServiceMeta(rows: Deployment[]): Promise<Map<string, ServiceMeta>> {
	const serviceIds = Array.from(new Set(rows.map(row => row.serviceId)));
	const map = new Map<string, ServiceMeta>();
	if (serviceIds.length === 0) return map;

	const svc = await db
		.select({ id: services.id, environmentId: services.environmentId, name: services.name })
		.from(services)
		.where(inArray(services.id, serviceIds));
	for (const row of svc) map.set(row.id, { environmentId: row.environmentId, name: row.name });
	return map;
}
