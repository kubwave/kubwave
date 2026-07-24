import { describe, expect, test } from 'bun:test';
import { effectiveWatchPaths, pathMatchesPrefix, pathsMatch } from '~/modules/worker/jobs/git-poll/watch-paths';

describe('effectiveWatchPaths', () => {
	test('returns empty when nothing is configured', () => {
		expect(effectiveWatchPaths({ repoUrl: 'https://x/r', branch: 'main', builder: 'nixpacks' } as never)).toEqual([]);
	});

	test('includes rootDirectory and watchPaths', () => {
		expect(
			effectiveWatchPaths({
				repoUrl: 'https://x/r',
				branch: 'main',
				builder: 'nixpacks',
				rootDirectory: 'apps/web',
				watchPaths: ['packages/db', 'packages/api-client']
			} as never)
		).toEqual(['apps/web', 'packages/db', 'packages/api-client']);
	});

	test('dedupes and strips slashes', () => {
		expect(
			effectiveWatchPaths({
				repoUrl: 'https://x/r',
				branch: 'main',
				builder: 'nixpacks',
				rootDirectory: '/apps/web/',
				watchPaths: ['apps/web', '/packages/db/']
			} as never)
		).toEqual(['apps/web', 'packages/db']);
	});

	test('returns empty when watchEntireRepo is true', () => {
		expect(
			effectiveWatchPaths({
				repoUrl: 'https://x/r',
				branch: 'main',
				builder: 'nixpacks',
				rootDirectory: 'apps/web',
				watchPaths: ['packages/db'],
				watchEntireRepo: true
			} as never)
		).toEqual([]);
	});

	test('supports watchPaths without rootDirectory', () => {
		expect(
			effectiveWatchPaths({
				repoUrl: 'https://x/r',
				branch: 'main',
				builder: 'nixpacks',
				watchPaths: ['docs']
			} as never)
		).toEqual(['docs']);
	});

	test('ignores slash-only rootDirectory', () => {
		expect(
			effectiveWatchPaths({
				repoUrl: 'https://x/r',
				branch: 'main',
				builder: 'nixpacks',
				rootDirectory: '/'
			} as never)
		).toEqual([]);
	});
});

describe('pathMatchesPrefix / pathsMatch', () => {
	test('matches exact file and nested paths', () => {
		expect(pathMatchesPrefix('apps/web/package.json', 'apps/web')).toBe(true);
		expect(pathMatchesPrefix('apps/web', 'apps/web')).toBe(true);
		expect(pathMatchesPrefix('apps/website/x', 'apps/web')).toBe(false);
		expect(pathMatchesPrefix('apps/api/x', 'apps/web')).toBe(false);
	});

	test('returns true when any changed file matches any prefix', () => {
		expect(pathsMatch(['README.md', 'apps/web/index.ts'], ['apps/web', 'packages/db'])).toBe(true);
		expect(pathsMatch(['README.md', 'apps/api/index.ts'], ['apps/web', 'packages/db'])).toBe(false);
	});

	test('empty prefixes always match', () => {
		expect(pathsMatch(['anything'], [])).toBe(true);
	});
});
