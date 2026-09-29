import { describe, expect, test } from 'bun:test';
import { serviceErrorMessage } from '../lib/api/api-error';

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

	test('shows a user-facing details.message (e.g. an invalid service reference)', () => {
		const message = 'env API_URL: ${{ services.web.url }}: no service named "web" in this environment';
		expect(serviceErrorMessage({ error: 'invalid_reference', details: { message } })).toBe(message);
	});

	test('falls back for non-object errors', () => {
		expect(serviceErrorMessage(new Error('network'), 'Could not create service.')).toBe('Could not create service.');
	});
});
