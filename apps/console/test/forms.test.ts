import { describe, expect, test } from 'bun:test';
import { fieldError } from '../lib/forms';

const meta = (overrides: Partial<{ isTouched: boolean; errors: unknown[] }>) => ({ isTouched: false, errors: [], ...overrides });

describe('fieldError', () => {
	test('stays quiet until the user touched the field', () => {
		expect(fieldError(meta({ errors: [{ message: 'Enter your email.' }] }))).toBeUndefined();
	});

	test('shows the first schema issue once touched', () => {
		expect(fieldError(meta({ isTouched: true, errors: [{ message: 'Enter your email.' }, { message: 'Too long.' }] }))).toBe('Enter your email.');
	});

	test('accepts plain string errors from custom validators', () => {
		expect(fieldError(meta({ isTouched: true, errors: ['Name is taken.'] }))).toBe('Name is taken.');
	});

	test('has nothing to show for a valid field', () => {
		expect(fieldError(meta({ isTouched: true }))).toBeUndefined();
	});
});
