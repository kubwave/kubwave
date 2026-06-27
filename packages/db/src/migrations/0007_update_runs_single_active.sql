-- Enforce at most one active (pending/running) update run at the DB level so the
-- application-side concurrency check is race-proof. A unique index on the constant
-- expression (1) with a partial predicate allows only a single qualifying row.

-- First collapse any pre-existing surplus active runs (keep the most recent) so the
-- unique index can be created on existing data.
UPDATE "update_runs"
SET status = 'failed', last_error = 'Superseded by single-active-run migration', finished_at = now()
WHERE status IN ('pending', 'running')
	AND id NOT IN (
		SELECT id FROM "update_runs" WHERE status IN ('pending', 'running') ORDER BY created_at DESC LIMIT 1
	);
--> statement-breakpoint
CREATE UNIQUE INDEX "update_runs_single_active" ON "update_runs" ((1)) WHERE status IN ('pending', 'running');
