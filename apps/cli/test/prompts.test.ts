import { describe, expect, mock, test } from 'bun:test';

const cancelled = Symbol('cancelled');
let textResponses: (string | symbol)[] = [];
const textPrompts: Array<{ validate?: (value: string) => string | undefined }> = [];

const cprompts = {
	isCancel: (value: unknown) => value === cancelled,
	text: mock(async (opts: { validate?: (value: string) => string | undefined }) => {
		textPrompts.push(opts);
		const val = textResponses.shift();
		if (val === undefined) return 'fallback';
		if (typeof val === 'symbol') return cancelled;
		return val;
	})
};

mock.module('@clack/prompts', () => cprompts);

const { promptInstallInputs } = await import('../src/lib/prompts.js');

describe('promptInstallInputs', () => {
	test('uses flag values when provided, skips text prompts', async () => {
		textPrompts.length = 0;
		const result = await promptInstallInputs({ domain: 'app.example.com', email: 'ops@example.com' });
		expect(result).toEqual({ domain: 'app.example.com', email: 'ops@example.com' });
		expect(textPrompts).toEqual([]);
	});

	test('uses domain flag and prompts for email', async () => {
		textPrompts.length = 0;
		textResponses = ['ops@example.com'];
		const result = await promptInstallInputs({ domain: 'app.example.com' });
		expect(result).toEqual({ domain: 'app.example.com', email: 'ops@example.com' });
	});

	test('uses email flag and prompts for domain', async () => {
		textPrompts.length = 0;
		textResponses = ['app.example.com'];
		const result = await promptInstallInputs({ email: 'ops@example.com' });
		expect(result).toEqual({ domain: 'app.example.com', email: 'ops@example.com' });
		expect(textPrompts[0]?.validate?.('not-a-domain')).toBe('Please enter a valid FQDN (e.g. app.example.com)');
		expect(textPrompts[0]?.validate?.('app.example.com')).toBeUndefined();
	});

	test('prompts for both domain and email when no flags', async () => {
		textResponses = ['app.example.com', 'ops@example.com'];
		const result = await promptInstallInputs({});
		expect(result).toEqual({ domain: 'app.example.com', email: 'ops@example.com' });
	});

	test('throws UserCancelledError when domain prompt is cancelled', async () => {
		textResponses = [cancelled];
		await expect(promptInstallInputs({})).rejects.toThrow('Installation aborted.');
	});

	test('throws UserCancelledError when email prompt is cancelled', async () => {
		textResponses = ['app.example.com', cancelled];
		await expect(promptInstallInputs({})).rejects.toThrow('Installation aborted.');
	});
});
