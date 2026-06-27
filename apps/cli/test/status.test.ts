import { describe, expect, mock, test } from 'bun:test';

let statusMode: 'installed' | 'missing' | 'error' = 'installed';
const logs: string[] = [];
const printAndExitCalls: unknown[] = [];

mock.module('~/lib/k8s.js', () => ({
	loadKubeConfig: () => ({
		getCurrentContext: () => 'test-context',
		getCurrentCluster: () => ({ server: 'https://test.example.com' }),
		makeApiClient: () => ({
			readNamespacedConfigMap: async ({ name }: { name: string }) => {
				if (name === 'kubwave-platform' && statusMode === 'installed') {
					return {
						data: {
							current_version: '1.2.3',
							channel: 'stable',
							installed_at: '2024-01-01',
							installed_by: 'cli'
						}
					};
				}
				if (statusMode === 'error') throw new Error('api unavailable');
				throw { code: 404 };
			}
		})
	})
}));

// Real errors module (so FatalCliError is the production class), with only printAndExit
// overridden to capture the error instead of calling process.exit.
const realErrors = await import('../src/lib/errors.js');
const { FatalCliError } = realErrors;
mock.module('~/lib/errors.js', () => ({
	...realErrors,
	printAndExit: (err: unknown) => {
		printAndExitCalls.push(err);
		throw err;
	}
}));

mock.module('@clack/prompts', () => ({
	intro: () => {},
	log: {
		info: (message: string) => logs.push(`info:${message}`),
		warn: (message: string) => logs.push(`warn:${message}`)
	},
	outro: () => {}
}));

const { registerStatusCommand } = await import('../src/commands/status.js');

// Registers the status command on a fake commander parent and returns the captured action handler.
function registerAndCaptureAction(): (opts: unknown) => Promise<void> {
	let captured: ((opts: unknown) => Promise<void>) | undefined;
	const parent = {
		command: () => ({
			description: () => ({
				option: () => ({
					action: (fn: (opts: unknown) => Promise<void>) => {
						captured = fn;
						return undefined;
					}
				})
			})
		})
	} as never;

	registerStatusCommand(parent);
	if (!captured) throw new Error('status action was not registered');
	return captured;
}

describe('status command', () => {
	test('registers and invokes status action handler', async () => {
		statusMode = 'installed';
		logs.length = 0;

		const action = registerAndCaptureAction();
		await action({ inCluster: false });

		expect(logs).toContain('info:Version:         1.2.3');
	});

	test('warns when the platform marker is missing', async () => {
		statusMode = 'missing';
		logs.length = 0;

		const action = registerAndCaptureAction();
		await action({ inCluster: false });

		expect(logs).toContain('warn:kubwave is not installed (no version marker found).');
	});

	test('reports non-not-found status read failures as a FatalCliError', async () => {
		statusMode = 'error';
		logs.length = 0;
		printAndExitCalls.length = 0;

		const action = registerAndCaptureAction();

		await expect(action({ inCluster: false })).rejects.toThrow('Failed to read status: api unavailable');
		expect(printAndExitCalls).toHaveLength(1);
		expect(printAndExitCalls[0]).toBeInstanceOf(FatalCliError);
	});
});
