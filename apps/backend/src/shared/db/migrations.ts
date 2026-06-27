import { runMigrations, sql } from '@kubwave/db';

const MIGRATE_LOCK_KEY = 947_283_104;
const DB_BOOT_TIMEOUT_MS = 180_000;
const DB_BOOT_RETRY_MS = 3000;

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function migrateOnBoot(): Promise<void> {
	const conn = await sql.reserve();
	try {
		await conn`select pg_advisory_lock(${MIGRATE_LOCK_KEY})`;
		await runMigrations();
		console.log('[backend:api] migrations applied');
	} finally {
		await conn`select pg_advisory_unlock(${MIGRATE_LOCK_KEY})`.catch(() => {});
		conn.release();
	}
}

export async function runBootMigrationsWithRetry(): Promise<void> {
	const deadline = Date.now() + DB_BOOT_TIMEOUT_MS;
	for (let attempt = 1; ; attempt++) {
		try {
			await migrateOnBoot();
			return;
		} catch (err) {
			if (Date.now() >= deadline) throw err;
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[backend:api] database not ready (attempt ${attempt}): ${message}; retrying in ${DB_BOOT_RETRY_MS / 1000}s`);
			await sleep(DB_BOOT_RETRY_MS);
		}
	}
}
