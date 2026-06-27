import { and, eq, inArray, lt, or } from 'drizzle-orm';
import type { KubeConfig } from '@kubernetes/client-node';
import { buildDefaultDomainForService, db, deployments, type DefaultDomainRuntime, type DefaultDomainSettings } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { RECONCILE_IN_FLIGHT_STATUSES } from './types.js';
import { reconcileOne } from './workflow/reconcile-one.js';
import { resolveServiceMeta } from './workflow/service-meta.js';

// Reconcile every in-flight/canceling deployment this worker owns, plus any whose
// lease has expired (a crashed worker's rows - re-claimed here for crash recovery).
export async function reconcileInFlight(kc: KubeConfig, defaultDomain: DefaultDomainSettings, runtime: DefaultDomainRuntime): Promise<void> {
	const leaseExpiry = new Date(Date.now() - env.leaseTimeoutMs);
	const rows = await db
		.select()
		.from(deployments)
		.where(
			and(
				inArray(deployments.status, [...RECONCILE_IN_FLIGHT_STATUSES]),
				or(eq(deployments.lockedBy, env.workerId), lt(deployments.lockedAt, leaseExpiry))
			)
		);

	const serviceMeta = await resolveServiceMeta(rows);
	for (const row of rows) {
		const meta = serviceMeta.get(row.serviceId);
		if (!meta) continue;
		// Identity-based (service id + name) so it's stable across configs; the deployer pairs it with the port.
		const defaultDomainHost = buildDefaultDomainForService(defaultDomain, runtime, { serviceId: row.serviceId, serviceName: meta.name });
		await reconcileOne({
			kc,
			deployment: row,
			environmentId: meta.environmentId,
			defaultDomainHost
		});
	}
}
