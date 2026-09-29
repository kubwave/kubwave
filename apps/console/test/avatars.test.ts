import { describe, expect, test } from 'bun:test';
import { initials } from '../features/shell/avatars';

describe('initials', () => {
	test('takes first and last name initials', () => {
		expect(initials('Jordan Alex Lee')).toBe('JL');
	});

	test('uses one letter for a single name and a placeholder for an empty one', () => {
		expect(initials('admin')).toBe('A');
		expect(initials('  ')).toBe('?');
	});
});
