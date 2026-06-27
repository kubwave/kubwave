import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | null = null;

function getDb(): ReturnType<typeof postgres> {
	if (!sql) {
		const url = process.env['DATABASE_URL'];
		if (url) {
			sql = postgres(url);
		} else {
			const host = process.env['POSTGRES_HOST'];
			const user = process.env['POSTGRES_USER'];
			const password = process.env['POSTGRES_PASSWORD'];
			const database = process.env['POSTGRES_DB'];
			const port = process.env['POSTGRES_PORT'];
			if (!host || !user || !password || !database) {
				throw new Error('Database connection requires DATABASE_URL or POSTGRES_HOST/USER/PASSWORD/DB env vars');
			}
			sql = postgres({ host, port: port ? Number(port) : 5432, user, password, database });
		}
	}
	return sql;
}

export async function updateRunStatus(runId: string, status: string, phase: string, error?: string): Promise<void> {
	const db = getDb();
	const now = new Date().toISOString();

	if (status === 'running' && phase) {
		await db`
			UPDATE update_runs
			SET status = ${status}, phase = ${phase}, started_at = COALESCE(started_at, ${now}::timestamptz)
			WHERE id = ${runId}::uuid
		`;
	} else if (status === 'succeeded' || status === 'failed' || status === 'rolled_back') {
		await db`
			UPDATE update_runs
			SET status = ${status}, phase = ${phase}, finished_at = ${now}::timestamptz
				${error ? db`, last_error = ${error}` : db``}
			WHERE id = ${runId}::uuid
		`;
	}
}

export async function setRunOldImageTags(runId: string, tags: Record<string, string>): Promise<void> {
	const db = getDb();
	await db`
		UPDATE update_runs
		SET old_image_tags = ${JSON.stringify(tags)}::jsonb
		WHERE id = ${runId}::uuid
	`;
}

export async function getJsonSetting<T>(key: string): Promise<T | null> {
	const db = getDb();
	const rows = await db<{ value: T }[]>`
		SELECT value
		FROM settings
		WHERE key = ${key}
		LIMIT 1
	`;
	return rows[0]?.value ?? null;
}

export async function closeDb(): Promise<void> {
	if (sql) {
		await sql.end();
		sql = null;
	}
}
