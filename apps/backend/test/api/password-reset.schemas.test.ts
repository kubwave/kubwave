import { describe, expect, test } from 'bun:test';
import { forgotPasswordSchema, resetPasswordSchema } from '~/modules/auth/auth.dto';

describe('password reset schemas', () => {
	test('forgot accepts a valid email', () => {
		expect(forgotPasswordSchema.parse({ email: 'user@example.com' })).toEqual({ email: 'user@example.com' });
	});
	test('forgot rejects an invalid email', () => {
		expect(() => forgotPasswordSchema.parse({ email: 'nope' })).toThrow();
	});
	test('reset accepts a token and an 8+ char password', () => {
		expect(resetPasswordSchema.parse({ token: 'abc', password: 'pass1234' })).toEqual({ token: 'abc', password: 'pass1234' });
	});
	test('reset rejects a password shorter than 8 chars', () => {
		expect(() => resetPasswordSchema.parse({ token: 'abc', password: 'pass123' })).toThrow();
	});
	test('reset rejects an empty token', () => {
		expect(() => resetPasswordSchema.parse({ token: '', password: 'longenough12' })).toThrow();
	});
});
