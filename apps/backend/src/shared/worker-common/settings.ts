import { eq } from 'drizzle-orm';
import { db, settings } from '@kubwave/db';

// Generic key/value settings store; the key namespaces the value shape.
export async function getSetting<T>(key: string): Promise<T | null> {
	const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
	return row ? (row.value as T) : null;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
