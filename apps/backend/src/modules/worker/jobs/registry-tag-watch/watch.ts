import { eq } from 'drizzle-orm';
import { db, services, type DockerImageServiceConfig } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { computeBackoffAt } from '../git-poll/schedule.js';
import { enqueueWatchDeployment } from './enqueue.js';
import { parseImageRef, resolveTagDigest } from './registry.js';
import type { WatchService } from './claim.js';

// Watch one claimed service: a new tag digest enqueues a pinned deployment; a 404 (tag not published yet) is expected and silent.
export async function watchService(service: WatchService, now: Date): Promise<void> {
	const config = service.config as DockerImageServiceConfig;
	const ref = parseImageRef(config.image, config.tag);
	try {
		const digest = await resolveTagDigest(ref, config.registryAuth, env.registryTagWatchTimeoutMs);
		if (digest && digest !== service.lastWatchedDigest) {
			await enqueueWatchDeployment(service, digest);
		}
		// Record the observed digest (even when unchanged) and clear any prior error.
		await db
			.update(services)
			.set({ lastWatchedDigest: digest ?? service.lastWatchedDigest, lastWatchError: null })
			.where(eq(services.id, service.id));
	} catch (err) {
		const message = errorMessage(err);
		console.warn(`[registry-tag-watch] service ${service.id} watch failed:`, message);
		await db
			.update(services)
			.set({
				lastWatchError: message,
				nextWatchAt: computeBackoffAt(now, env.registryTagWatchServiceIntervalSeconds, env.registryTagWatchErrorBackoffSeconds)
			})
			.where(eq(services.id, service.id));
	}
}
