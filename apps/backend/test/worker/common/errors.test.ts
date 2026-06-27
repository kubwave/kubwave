import { describe, expect, it } from 'bun:test';
import { errorMessage } from '~/shared/worker-common/errors';

describe('errorMessage', () => {
	it('returns the message of an Error', () => {
		expect(errorMessage(new Error('boom'))).toBe('boom');
	});
	it('stringifies a non-Error', () => {
		expect(errorMessage('nope')).toBe('nope');
		expect(errorMessage(42)).toBe('42');
	});
});
