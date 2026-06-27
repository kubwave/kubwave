export const PR_PREVIEW_SETTINGS_KEY = 'pr-preview';

export interface PrPreviewSettings {
	// Max simultaneous preview environments per project. 0 pauses preview creation.
	maxPreviewsPerProject: number;
}

export const PR_PREVIEW_DEFAULTS: PrPreviewSettings = { maxPreviewsPerProject: 5 };
export const DEFAULT_MAX_PREVIEWS_PER_PROJECT = PR_PREVIEW_DEFAULTS.maxPreviewsPerProject;

export function resolvePrPreviewSettings(value: unknown): PrPreviewSettings {
	const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<PrPreviewSettings>) : {};
	const raw = v.maxPreviewsPerProject;
	const valid = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0;
	return { maxPreviewsPerProject: valid ? raw : PR_PREVIEW_DEFAULTS.maxPreviewsPerProject };
}
