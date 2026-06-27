// Per-project cap on simultaneous preview environments, in the settings store under `pr-preview`.
import { DEFAULT_MAX_PREVIEWS_PER_PROJECT, PR_PREVIEW_SETTINGS_KEY, resolvePrPreviewSettings } from '@kubwave/kube';

export { DEFAULT_MAX_PREVIEWS_PER_PROJECT, PR_PREVIEW_SETTINGS_KEY };

// Missing/non-integer/negative falls back to the default; 0 is allowed (pauses preview creation).
export function normalizeMaxPreviews(raw: unknown): number {
	return resolvePrPreviewSettings({ maxPreviewsPerProject: raw }).maxPreviewsPerProject;
}

export async function getMaxPreviewsPerProject(): Promise<number> {
	// Lazy import so the pure helper above stays unit-testable without a DB client.
	const { db, settings } = await import('@kubwave/db');
	const { eq } = await import('drizzle-orm');
	const [row] = await db.select().from(settings).where(eq(settings.key, PR_PREVIEW_SETTINGS_KEY)).limit(1);
	return resolvePrPreviewSettings(row?.value).maxPreviewsPerProject;
}
