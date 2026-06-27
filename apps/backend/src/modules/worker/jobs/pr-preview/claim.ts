import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db, environments, type Environment } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { computeNextPollAt } from '../git-poll/schedule.js';

// Claim persistent, previews-enabled envs due for a discovery sweep, HA-safely (FOR UPDATE SKIP
// LOCKED + push pr_next_poll_at forward as the lease). Returns full rows - the sweep needs them.
export async function claimDueEnvironments(now: Date, limit: number): Promise<Environment[]> {
	return db.transaction(async tx => {
		const rows = await tx
			.select()
			.from(environments)
			.where(
				and(
					eq(environments.kind, 'persistent'),
					eq(environments.prPreviewsEnabled, true),
					or(isNull(environments.prNextPollAt), lte(environments.prNextPollAt, now))
				)
			)
			.orderBy(sql`${environments.prNextPollAt} asc nulls first`)
			.limit(limit)
			.for('update', { skipLocked: true });

		for (const row of rows) {
			await tx
				.update(environments)
				.set({ prNextPollAt: computeNextPollAt(now, env.prDiscoveryEnvIntervalSeconds), prLastPolledAt: now })
				.where(eq(environments.id, row.id));
		}
		return rows;
	});
}
