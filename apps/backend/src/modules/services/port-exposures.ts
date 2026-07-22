import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { servicePortExposures, type Database, type ServicePortExposure } from '@kubwave/db';
import type { TcpPortPoolConfig } from '../../shared/config/backend-config.service.js';
import { PortExposureDisabledError, PortPoolExhaustedError } from './services.errors.js';

type ExposureTx = Parameters<Parameters<Database['transaction']>[0]>[0];

// Converge a service's TCP exposures to the desired container ports (keep/free/allocate); runs in the caller's transaction so service + exposures commit together.
export async function reconcileExposedPorts(
	tx: ExposureTx,
	serviceId: string,
	desiredContainerPorts: number[],
	pool: TcpPortPoolConfig
): Promise<ServicePortExposure[]> {
	const existing = await tx.select().from(servicePortExposures).where(eq(servicePortExposures.serviceId, serviceId));
	const desired = new Set(desiredContainerPorts);

	const stale = existing.filter(row => !desired.has(row.containerPort));
	if (stale.length > 0) {
		await tx.delete(servicePortExposures).where(
			inArray(
				servicePortExposures.id,
				stale.map(row => row.id)
			)
		);
	}

	const kept = existing.filter(row => desired.has(row.containerPort));
	const result = kept.map(row => ({ containerPort: row.containerPort, publicPort: row.publicPort }));
	const missing = [...desired].filter(port => !kept.some(row => row.containerPort === port));
	if (missing.length === 0) return result.sort(byContainerPort);
	if (!pool.enabled || pool.size <= 0) throw new PortExposureDisabledError();

	const end = pool.start + pool.size - 1;
	const takenRows = await tx
		.select({ publicPort: servicePortExposures.publicPort })
		.from(servicePortExposures)
		.where(and(gte(servicePortExposures.publicPort, pool.start), lte(servicePortExposures.publicPort, end)));
	const taken = new Set(takenRows.map(row => row.publicPort));

	for (const containerPort of missing) {
		let allocated: number | null = null;
		for (let candidate = pool.start; candidate <= end; candidate++) {
			if (taken.has(candidate)) continue;
			// onConflictDoNothing keeps the transaction usable after a race loss (a raised error would poison it).
			const inserted = await tx
				.insert(servicePortExposures)
				.values({ serviceId, containerPort, publicPort: candidate })
				.onConflictDoNothing({ target: servicePortExposures.publicPort })
				.returning({ publicPort: servicePortExposures.publicPort });
			if (inserted.length > 0) {
				allocated = candidate;
				taken.add(candidate);
				break;
			}
			taken.add(candidate);
		}
		if (allocated == null) throw new PortPoolExhaustedError();
		result.push({ containerPort, publicPort: allocated });
	}

	return result.sort(byContainerPort);
}

function byContainerPort(a: ServicePortExposure, b: ServicePortExposure): number {
	return a.containerPort - b.containerPort;
}
