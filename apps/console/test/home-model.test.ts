import { describe, expect, test } from 'bun:test';
import { visibleProjects } from '../features/home/model';

const project = (name: string, description: string, updatedAt: string) => ({ name, description, updatedAt });
const projects = [
	project('storefront', 'Shop frontend', '2026-09-01T10:00:00Z'),
	project('analytics', 'Plausible for all sites', '2026-09-20T10:00:00Z'),
	project('billing', '', '2026-09-10T10:00:00Z')
];

describe('visibleProjects', () => {
	test('lists the most recently updated projects first', () => {
		expect(visibleProjects(projects, '', 'recent').map(p => p.name)).toEqual(['analytics', 'billing', 'storefront']);
	});

	test('sorts by name on request', () => {
		expect(visibleProjects(projects, '', 'name').map(p => p.name)).toEqual(['analytics', 'billing', 'storefront']);
	});

	test('matches name or description, case-insensitively', () => {
		expect(visibleProjects(projects, 'SHOP', 'recent').map(p => p.name)).toEqual(['storefront']);
		expect(visibleProjects(projects, 'bill', 'recent').map(p => p.name)).toEqual(['billing']);
		expect(visibleProjects(projects, 'nothing', 'recent')).toEqual([]);
	});
});
