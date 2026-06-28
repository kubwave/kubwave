import { describe, expect, test } from 'bun:test';
import { forgotPasswordSchema, resetPasswordSchema } from '~/modules/auth/auth.dto';

describe('password reset schemas', () => {
	test('forgot accepts a valid email', () => {
		expect(forgotPasswordSchema.parse({ email: 'user@example.com' })).toEqual({ email: 'user@example.com' });
	});
	test('forgot rejects an invalid email', () => {
		expect(() => forgotPasswordSchema.parse({ email: 'nope' })).toThrow();
	});
	test('reset accepts a token and a 12+ char password', () => {
		expect(resetPasswordSchema.parse({ token: 'abc', password: 'longenough12' })).toEqual({ token: 'abc', password: 'longenough12' });
	});
	test('reset rejects a short password', () => {
		expect(() => resetPasswordSchema.parse({ token: 'abc', password: 'short' })).toThrow();
	});
	test('reset rejects an empty token', () => {
		expect(() => resetPasswordSchema.parse({ token: '', password: 'longenough12' })).toThrow();
	});
});
