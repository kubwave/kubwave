// Global cap on in-flight deployments, read from the settings store under `deployment-concurrency`.
import { DEFAULT_MAX_CONCURRENT_DEPLOYMENTS, DEPLOYMENT_CONCURRENCY_SETTINGS_KEY, resolveDeploymentConcurrencySettings } from '@kubwave/kube';

export { DEFAULT_MAX_CONCURRENT_DEPLOYMENTS, DEPLOYMENT_CONCURRENCY_SETTINGS_KEY };

// Missing / non-integer / <1 falls back to the default so a bad setting can't wedge the queue (0 would stop every deployment).
export function normalizeMax(raw: unknown): number {
	return resolveDeploymentConcurrencySettings({ maxConcurrentDeployments: raw }).maxConcurrentDeployments;
}

// Pending rows a tick may claim: free slots under the cap, bounded by the per-tick batch. Never negative.
export function computeClaimLimit(max: number, inflight: number, batch: number): number {
	return Math.max(0, Math.min(batch, max - inflight));
}

export async function getMaxConcurrentDeployments(): Promise<number> {
	// Lazy import so the pure helpers above stay importable (and unit-testable) without a DB client.
	const { db, settings } = await import('@kubwave/db');
	const { eq } = await import('drizzle-orm');
	const [row] = await db.select().from(settings).where(eq(settings.key, DEPLOYMENT_CONCURRENCY_SETTINGS_KEY)).limit(1);
	return resolveDeploymentConcurrencySettings(row?.value).maxConcurrentDeployments;
}
