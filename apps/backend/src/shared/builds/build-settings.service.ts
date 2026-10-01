import { db, settings } from '@kubwave/db';
import { eq } from 'drizzle-orm';
import { env } from '../config/worker-env.js';
import { BUILD_SETTINGS_KEY, resolveBuildSettings } from './settings.js';

export async function getBuildSettings() {
	const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, BUILD_SETTINGS_KEY)).limit(1);
	return resolveBuildSettings(row?.value, {
		memoryRequest: env.buildMemoryRequest,
		memoryLimit: env.buildMemoryLimit,
		timeoutSeconds: env.buildTimeoutSeconds
	});
}
