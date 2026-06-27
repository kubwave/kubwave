import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, services, type ServiceConfig, type ServiceType } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { computeNextPollAt } from './schedule.js';

// docker-image (prebuilt) and dockerfile (inline) have no upstream branch to follow, so they're excluded.
const POLLABLE_TYPES: ServiceType[] = ['public-repo', 'private-repo'];

export interface DueService {
	id: string;
	type: ServiceType;
	config: ServiceConfig;
	lastPolledCommit: string | null;
}

// HA-safe claim: FOR UPDATE SKIP LOCKED so peers skip these rows; advancing next_poll_at is the lease.
// ls-remote runs outside this tx so we never hold a row lock across the network.
export async function claimDueServices(now: Date, limit: number): Promise<DueService[]> {
	return db.transaction(async tx => {
		const rows = await tx
			.select({
				id: services.id,
				type: services.type,
				config: services.config,
				lastPolledCommit: services.lastPolledCommit
			})
			.from(services)
			.where(
				and(
					eq(services.autoDeployEnabled, true),
					inArray(services.type, POLLABLE_TYPES),
					or(isNull(services.nextPollAt), lte(services.nextPollAt, now))
				)
			)
			.orderBy(sql`${services.nextPollAt} asc nulls first`)
			.limit(limit)
			.for('update', { skipLocked: true });

		for (const row of rows) {
			await tx
				.update(services)
				.set({ nextPollAt: computeNextPollAt(now, env.gitPollServiceIntervalSeconds), lastPolledAt: now })
				.where(eq(services.id, row.id));
		}
		return rows;
	});
}
