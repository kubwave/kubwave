import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { db, sql } from './client';

export async function runMigrations(folder?: string): Promise<void> {
	const migrationsFolder = folder ?? process.env.DRIZZLE_MIGRATIONS_DIR ?? fileURLToPath(new URL('./migrations', import.meta.url));
	await migrate(db, { migrationsFolder });
}

if (import.meta.main) {
	await runMigrations();
	await sql.end();
}
