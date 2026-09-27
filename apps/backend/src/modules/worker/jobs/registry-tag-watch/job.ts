import { env } from '../../../../shared/config/worker-env.js';
import { claimDueWatchServices } from './claim.js';
import { watchService } from './watch.js';

// One sweep tick: claim a batch of due docker-image services and resolve their tag digests concurrently.
export async function runTagWatch(): Promise<void> {
	const now = new Date();
	const due = await claimDueWatchServices(now, env.registryTagWatchBatch);
	if (due.length === 0) return;
	await Promise.all(due.map(service => watchService(service, now)));
}
