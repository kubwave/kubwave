import { afterEach, describe, expect, mock, test } from 'bun:test';

// Stub @kubwave/db's settings-row select so getMaxPreviewsPerProject is driveable.
let selectRows: unknown[] = [];

mock.module('@kubwave/db', () => ({
	settings: { key: 'key' },
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: async () => selectRows }) }) })
	}
}));

const { normalizeMaxPreviews, getMaxPreviewsPerProject, DEFAULT_MAX_PREVIEWS_PER_PROJECT, PR_PREVIEW_SETTINGS_KEY } =
	await import('~/modules/worker/jobs/pr-preview/cap');

afterEach(() => {
	selectRows = [];
});

describe('normalizeMaxPreviews', () => {
	test('passes a valid non-negative integer through (0 pauses creation)', () => {
		expect(normalizeMaxPreviews(3)).toBe(3);
		expect(normalizeMaxPreviews(0)).toBe(0);
	});
	test('falls back to the default for invalid values', () => {
		expect(normalizeMaxPreviews(-1)).toBe(DEFAULT_MAX_PREVIEWS_PER_PROJECT);
		expect(normalizeMaxPreviews(2.5)).toBe(DEFAULT_MAX_PREVIEWS_PER_PROJECT);
		expect(normalizeMaxPreviews('5')).toBe(DEFAULT_MAX_PREVIEWS_PER_PROJECT);
		expect(normalizeMaxPreviews(undefined)).toBe(DEFAULT_MAX_PREVIEWS_PER_PROJECT);
		expect(normalizeMaxPreviews(null)).toBe(DEFAULT_MAX_PREVIEWS_PER_PROJECT);
	});
	test('the settings key matches the documented literal', () => {
		expect(PR_PREVIEW_SETTINGS_KEY).toBe('pr-preview');
	});
});

describe('getMaxPreviewsPerProject', () => {
	test('reads the stored cap from the settings row value', async () => {
		selectRows = [{ value: { maxPreviewsPerProject: 8 } }];
		expect(await getMaxPreviewsPerProject()).toBe(8);
	});
	test('returns the default when no settings row exists', async () => {
		selectRows = [];
		expect(await getMaxPreviewsPerProject()).toBe(DEFAULT_MAX_PREVIEWS_PER_PROJECT);
	});
	test('returns the default when the stored value is malformed', async () => {
		selectRows = [{ value: { maxPreviewsPerProject: 'nope' } }];
		expect(await getMaxPreviewsPerProject()).toBe(DEFAULT_MAX_PREVIEWS_PER_PROJECT);
	});
	test('honours a stored 0 (paused) cap', async () => {
		selectRows = [{ value: { maxPreviewsPerProject: 0 } }];
		expect(await getMaxPreviewsPerProject()).toBe(0);
	});
});
