import { env } from '../../../../shared/config/worker-env.js';
import { claimDueServices } from './claim.js';
import { pollService } from './poll.js';

// One sweep tick: claim a batch of due services and poll them concurrently. The batch
// size bounds concurrency; services beyond it are handled on subsequent ticks.
export async function runGitPoll(): Promise<void> {
	const now = new Date();
	const due = await claimDueServices(now, env.gitPollBatch);
	if (due.length === 0) return;
	await Promise.all(due.map(service => pollService(service, now)));
}
