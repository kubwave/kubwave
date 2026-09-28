import { describe, expect, test } from 'bun:test';
import { findNavEntry, flatNav, getPager } from '../lib/nav';

describe('findNavEntry', () => {
	test('finds /start/quickstart in the Get started group', () => {
		expect(findNavEntry('/start/quickstart')).toEqual({ title: 'Quickstart', path: '/start/quickstart', group: 'Get started' });
	});

	test('ignores a trailing slash', () => {
		expect(findNavEntry('/start/quickstart/')?.path).toBe('/start/quickstart');
	});

	test('returns undefined for a page outside the sidebar', () => {
		expect(findNavEntry('/nope')).toBeUndefined();
	});
});

describe('getPager', () => {
	test('links /start/quickstart to Introduction and Supported providers', () => {
		const pager = getPager('/start/quickstart');
		expect(pager.previous?.title).toBe('Introduction');
		expect(pager.next?.title).toBe('Supported providers');
	});

	test('crosses group boundaries in sidebar order', () => {
		expect(getPager('/providers/cloudfleet-hetzner').previous?.path).toBe('/start/architecture');
	});

	test('has no previous page on the first entry and no next page on the last', () => {
		expect(getPager(flatNav[0]!.path).previous).toBeUndefined();
		expect(getPager(flatNav.at(-1)!.path).next).toBeUndefined();
	});

	test('is empty for a page outside the sidebar', () => {
		expect(getPager('/nope')).toEqual({});
	});
});
