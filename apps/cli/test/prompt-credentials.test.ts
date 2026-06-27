import { describe, expect, mock, test } from 'bun:test';

const cancelled = Symbol('cancelled');
let textResponses: (string | symbol)[] = [];
const textPrompts: Array<{ validate?: (value: string) => string | undefined }> = [];
const passwordPrompts: Array<{ validate?: (value: string) => string | undefined }> = [];

mock.module('@clack/prompts', () => ({
	isCancel: (value: unknown) => value === cancelled,
	text: mock(async (opts: { validate?: (value: string) => string | undefined }) => {
		textPrompts.push(opts);
		const val = textResponses.shift();
		if (val === undefined) return 'default';
		if (typeof val === 'symbol') return cancelled;
		return val;
	}),
	password: mock(async (opts: { validate?: (value: string) => string | undefined }) => {
		passwordPrompts.push(opts);
		const val = textResponses.shift();
		if (val === undefined) return 'default-pass';
		if (typeof val === 'symbol') return cancelled;
		return val;
	})
}));

const { promptImagePullCredentials } = await import('../src/lib/secrets.js');

describe('promptImagePullCredentials', () => {
	test('returns username and password from user input', async () => {
		textPrompts.length = 0;
		passwordPrompts.length = 0;
		textResponses = ['github-user', 'github-pat-token'];
		const result = await promptImagePullCredentials();
		expect(result).toEqual({ username: 'github-user', password: 'github-pat-token' });
		expect(textPrompts[0]?.validate?.('   ')).toBe('Username is required');
		expect(textPrompts[0]?.validate?.('github-user')).toBeUndefined();
		expect(passwordPrompts[0]?.validate?.('   ')).toBe('Token is required');
		expect(passwordPrompts[0]?.validate?.('github-pat-token')).toBeUndefined();
	});

	test('throws UserCancelledError when username prompt is cancelled', async () => {
		textResponses = [cancelled];
		await expect(promptImagePullCredentials()).rejects.toThrow('Installation aborted.');
	});

	test('throws UserCancelledError when password prompt is cancelled', async () => {
		textResponses = ['github-user', cancelled];
		await expect(promptImagePullCredentials()).rejects.toThrow('Installation aborted.');
	});
});
