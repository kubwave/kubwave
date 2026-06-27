import { checkForUpdates } from './check.js';

export const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function runVersionPoll(): Promise<void> {
	await checkForUpdates();
}
