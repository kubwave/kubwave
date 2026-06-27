// Pure scheduling + decision helpers for the git-poll job, IO-free for unit-testability.

// Due when remote SHA differs from the last we triggered on. SHA is recorded post-deploy, so a failed build never auto-retries — only a new push.
export function shouldDeploy(remoteSha: string | null | undefined, lastPolledCommit: string | null | undefined): boolean {
	if (!remoteSha) return false;
	return remoteSha !== lastPolledCommit;
}

// Next poll after success: now + interval, jittered ±jitterRatio to avoid stampede; the delay doubles as the peer-replica lease.
export function computeNextPollAt(now: Date, intervalSeconds: number, jitterRatio = 0.2, rng: () => number = Math.random): Date {
	const base = Math.max(1, intervalSeconds);
	// rng() in [0,1) -> factor in [1-jitter, 1+jitter)
	const factor = 1 + (rng() * 2 - 1) * jitterRatio;
	const delayMs = Math.round(base * factor * 1000);
	return new Date(now.getTime() + delayMs);
}

// Next poll after a failed poll: a flat longer interval (jittered, not exponential — no per-service failure counter) so a broken service backs off.
export function computeBackoffAt(now: Date, intervalSeconds: number, backoffSeconds: number, rng: () => number = Math.random): Date {
	const delaySeconds = Math.max(Math.max(1, intervalSeconds), Math.max(1, backoffSeconds));
	return computeNextPollAt(now, delaySeconds, 0.2, rng);
}
