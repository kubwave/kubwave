import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Bounded so a not-yet-ready database fails fast and lets the caller's retry loop take over instead of hanging.
const CONNECT_TIMEOUT_SECONDS = 10;

function createClient(): ReturnType<typeof postgres> {
	const url = process.env.DATABASE_URL;
	if (url) return postgres(url, { connect_timeout: CONNECT_TIMEOUT_SECONDS });

	const host = process.env.POSTGRES_HOST;
	const user = process.env.POSTGRES_USER;
	const password = process.env.POSTGRES_PASSWORD;
	const database = process.env.POSTGRES_DB;
	const port = process.env.POSTGRES_PORT;

	if (!host || !user || !password || !database) {
		throw new Error('Database connection requires DATABASE_URL or POSTGRES_HOST/USER/PASSWORD/DB env vars');
	}

	return postgres({ host, port: port ? Number(port) : 5432, user, password, database, connect_timeout: CONNECT_TIMEOUT_SECONDS });
}

// Isolated connection + ORM pair from the ambient env; api/worker call once at boot, tests use it for throwaway clients.
export function createDb(): { sql: ReturnType<typeof postgres>; db: ReturnType<typeof drizzle<typeof schema>> } {
	const sql = createClient();
	return { sql, db: drizzle(sql, { schema }) };
}

export type Database = ReturnType<typeof createDb>['db'];

// Process-wide singleton — console import path. New apps may use createDb() instead.
export const sql = createClient();
export const db = drizzle(sql, { schema });
