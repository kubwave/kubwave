import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db, services, type ServiceConfig, type ServiceType } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { computeNextPollAt } from '../git-poll/schedule.js';

export interface WatchService {
	id: string;
	type: ServiceType;
	config: ServiceConfig;
	lastWatchedDigest: string | null;
}

// HA-safe claim for the tag-watch sweep: FOR UPDATE SKIP LOCKED so peer replicas skip these rows; advancing next_watch_at is the lease.
// The registry HEAD runs outside this tx so a row lock is never held across the network.
export async function claimDueWatchServices(now: Date, limit: number): Promise<WatchService[]> {
	return db.transaction(async tx => {
		const rows = await tx
			.select({
				id: services.id,
				type: services.type,
				config: services.config,
				lastWatchedDigest: services.lastWatchedDigest
			})
			.from(services)
			.where(
				and(eq(services.imageWatchEnabled, true), eq(services.type, 'docker-image'), or(isNull(services.nextWatchAt), lte(services.nextWatchAt, now)))
			)
			.orderBy(sql`${services.nextWatchAt} asc nulls first`)
			.limit(limit)
			.for('update', { skipLocked: true });

		for (const row of rows) {
			await tx
				.update(services)
				.set({ nextWatchAt: computeNextPollAt(now, env.registryTagWatchServiceIntervalSeconds), lastWatchedAt: now })
				.where(eq(services.id, row.id));
		}
		return rows;
	});
}
