import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db, settings } from '@kubwave/db';

@Injectable()
export class SettingsService {
	async get<T>(key: string): Promise<T | null> {
		const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
		return row ? (row.value as T) : null;
	}

	async set<T>(key: string, value: T): Promise<void> {
		await db
			.insert(settings)
			.values({ key, value })
			.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
	}
}
