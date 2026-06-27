import { describe, expect, test } from 'bun:test';
import { serviceErrorMessage } from '../app/utils/api-error';

describe('serviceErrorMessage', () => {
	test('maps service_name_taken to a friendly duplicate-name message', () => {
		expect(serviceErrorMessage({ error: 'service_name_taken' })).toBe('A service with that name already exists.');
	});

	test('returns the provided fallback for any other error code', () => {
		expect(serviceErrorMessage({ error: 'something_else' }, 'Could not create service.')).toBe('Could not create service.');
	});

	test('uses a default fallback when none is given', () => {
		expect(serviceErrorMessage({ error: 'boom' })).toBe('Could not save service.');
	});

	test('falls back for non-object errors', () => {
		expect(serviceErrorMessage(new Error('network'), 'Could not create service.')).toBe('Could not create service.');
	});
});
