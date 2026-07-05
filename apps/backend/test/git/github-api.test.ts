import { describe, expect, test } from 'bun:test';
import { mapRepoPage } from '~/modules/git/github-api';

describe('mapRepoPage', () => {
	test('maps full_name/default_branch/private and defaults a missing branch to main', () => {
		expect(
			mapRepoPage([
				{ full_name: 'acme/api', default_branch: 'develop', private: true },
				{ full_name: 'acme/web', private: false }
			])
		).toEqual([
			{ fullName: 'acme/api', defaultBranch: 'develop', isPrivate: true },
			{ fullName: 'acme/web', defaultBranch: 'main', isPrivate: false }
		]);
	});

	test('treats a missing private flag as private (safe default)', () => {
		expect(mapRepoPage([{ full_name: 'acme/x' }])[0]!.isPrivate).toBe(true);
	});

	test('skips malformed items and non-array input', () => {
		expect(mapRepoPage([{ id: 1 }, { full_name: '' }, 'nope'])).toEqual([]);
		expect(mapRepoPage(null)).toEqual([]);
		expect(mapRepoPage(undefined)).toEqual([]);
	});
});
