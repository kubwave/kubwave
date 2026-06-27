import { describe, expect, mock, test } from 'bun:test';

let consoleOutput: string[] = [];

mock.module('~/lib/k8s.js', () => ({
	loadKubeConfig: () => ({
		getCurrentContext: () => 'test-context',
		makeApiClient: () => ({
			readNamespacedConfigMap: async () => ({
				data: { current_version: '1.2.3', channel: 'stable' }
			})
		})
	})
}));

const { registerVersionCommand } = await import('../src/commands/version.js');

describe('version command', () => {
	test('registers and executes version action', async () => {
		consoleOutput = [];
		const realLog = console.log;
		console.log = (...args: string[]) => {
			consoleOutput.push(args.join(' '));
		};

		let capturedAction: ((opts: unknown) => Promise<void>) | undefined;
		const parent = {
			command: (_name: string) => ({
				description: () => ({
					option: (_opt: string, _desc: string, _default: boolean) => ({
						action: (fn: (opts: unknown) => Promise<void>) => {
							capturedAction = fn;
						}
					})
				})
			})
		} as never;

		try {
			registerVersionCommand(parent);
			expect(capturedAction).toBeDefined();

			await capturedAction!({ inCluster: false });

			expect(consoleOutput.length).toBeGreaterThanOrEqual(2);
			expect(consoleOutput.some(line => line.includes('kubwave CLI'))).toBe(true);
			expect(consoleOutput.some(line => line.includes('Channel'))).toBe(true);
		} finally {
			console.log = realLog;
		}
	});

	test('version command handles cluster connection failure gracefully', async () => {
		consoleOutput = [];
		const realLog = console.log;
		console.log = (...args: string[]) => {
			consoleOutput.push(args.join(' '));
		};

		const { registerVersionCommand: reg2 } = await importWithFailingK8s();

		let capturedAction: ((opts: unknown) => Promise<void>) | undefined;
		const parent = {
			command: () => ({
				description: () => ({
					option: () => ({
						action: (fn: (opts: unknown) => Promise<void>) => {
							capturedAction = fn;
						}
					})
				})
			})
		} as never;

		try {
			reg2(parent);
			await capturedAction!({ inCluster: false });

			expect(consoleOutput.some(line => line.includes('no cluster connection'))).toBe(true);
		} finally {
			console.log = realLog;
		}
	});
});

async function importWithFailingK8s() {
	mock.module('~/lib/k8s.js', () => ({
		loadKubeConfig: () => {
			throw new Error('no kubeconfig');
		}
	}));
	return import('../src/commands/version.js');
}
