import { describe, expect, test } from 'bun:test';
import { projectHref, projectSettingsHref, resolveEnvironment } from '../lib/routes';
import { oneOf, withSearchParams } from '../lib/search-params';

describe('oneOf', () => {
	test('accepts a known value and falls back otherwise', () => {
		const tabs = ['deployments', 'settings'] as const;
		expect(oneOf('settings', tabs, 'deployments')).toBe('settings');
		expect(oneOf('bogus', tabs, 'deployments')).toBe('deployments');
		expect(oneOf(null, tabs, 'deployments')).toBe('deployments');
	});
});

describe('withSearchParams', () => {
	test('sets and removes query keys and keeps the rest', () => {
		expect(withSearchParams('?env=e1&service=s1', { tab: 'logs' })).toBe('?env=e1&service=s1&tab=logs');
		expect(withSearchParams('?env=e1&tab=logs&section=volumes', { tab: null, section: null })).toBe('?env=e1');
		expect(withSearchParams('?tab=logs', { tab: null })).toBe('');
	});
});

const env = (id: string, name: string, kind: 'persistent' | 'preview' = 'persistent') => ({ id, name, kind });

describe('projectHref', () => {
	test('links to the canvas, optionally with environment and open service', () => {
		expect(projectHref('p1')).toBe('/team/projects/p1');
		expect(projectHref('p1', { env: 'e2' })).toBe('/team/projects/p1?env=e2');
		expect(projectHref('p1', { env: 'e2', service: 's3' })).toBe('/team/projects/p1?env=e2&service=s3');
	});

	test('keeps the open panel tab and settings section', () => {
		expect(projectHref('p1', { env: 'e2', service: 's3', tab: 'settings', section: 'networking' })).toBe(
			'/team/projects/p1?env=e2&service=s3&tab=settings&section=networking'
		);
	});

	test('links to the project settings page', () => {
		expect(projectSettingsHref('p1')).toBe('/team/projects/p1/settings');
	});
});

describe('resolveEnvironment', () => {
	const environments = [env('e-prev', 'pr-12', 'preview'), env('e-stage', 'staging'), env('e-prod', 'production')];

	test('uses the environment named in the URL', () => {
		expect(resolveEnvironment(environments, 'e-stage')?.id).toBe('e-stage');
	});

	test('falls back to the first persistent environment for a missing or stale id', () => {
		expect(resolveEnvironment(environments, undefined)?.id).toBe('e-stage');
		expect(resolveEnvironment(environments, 'deleted')?.id).toBe('e-stage');
	});

	test('falls back to any environment when only previews exist, and to none for an empty project', () => {
		expect(resolveEnvironment([env('e-prev', 'pr-12', 'preview')], undefined)?.id).toBe('e-prev');
		expect(resolveEnvironment([], 'x')).toBeUndefined();
	});
});
