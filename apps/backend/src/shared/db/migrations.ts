import { runMigrations, sql } from '@kubwave/db';

const MIGRATE_LOCK_KEY = 947_283_104;
const DB_BOOT_TIMEOUT_MS = 180_000;
const DB_BOOT_RETRY_MS = 3000;

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export async function migrateOnBoot(): Promise<void> {
	const conn = await sql.reserve();
	try {
		// Non-blocking: pg_advisory_lock waits forever, so a stale lock (a prior pod killed mid-migration whose
		// session Postgres hasn't reaped yet) would hang boot migrations silently. try-lock makes a held lock a
		// retryable error instead, so the retry loop surfaces it (and eventually exits) rather than hanging.
		const [row] = await conn<{ locked: boolean }[]>`select pg_try_advisory_lock(${MIGRATE_LOCK_KEY}) as locked`;
		if (!row?.locked) throw new Error('migration advisory lock is held by another instance; will retry');
		try {
			await runMigrations();
			console.log('[backend:api] migrations applied');
		} finally {
			await conn`select pg_advisory_unlock(${MIGRATE_LOCK_KEY})`.catch(() => {});
		}
	} finally {
		conn.release();
	}
}

export interface BootMigrationOptions {
	timeoutMs?: number;
	retryMs?: number;
	migrate?: () => Promise<void>;
}

export async function runBootMigrationsWithRetry(options: BootMigrationOptions = {}): Promise<void> {
	const timeoutMs = options.timeoutMs ?? DB_BOOT_TIMEOUT_MS;
	const retryMs = options.retryMs ?? DB_BOOT_RETRY_MS;
	const migrate = options.migrate ?? migrateOnBoot;
	const deadline = Date.now() + timeoutMs;
	for (let attempt = 1; ; attempt++) {
		try {
			await migrate();
			return;
		} catch (err) {
			if (Date.now() >= deadline) throw err;
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[backend:api] database not ready (attempt ${attempt}): ${message}; retrying in ${retryMs / 1000}s`);
			await sleep(retryMs);
		}
	}
}
