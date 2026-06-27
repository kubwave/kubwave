import { describe, expect, mock, test } from 'bun:test';

const logs: string[] = [];
let confirmAnswer: boolean | symbol = true;
const cancelled = Symbol('cancelled');

mock.module('@clack/prompts', () => ({
	log: {
		info: (msg: string) => logs.push(`info:${msg}`),
		step: (msg: string) => logs.push(`step:${msg}`)
	},
	confirm: async () => confirmAnswer,
	isCancel: (value: unknown) => value === cancelled
}));

const { confirmClusterContext } = await import('../src/lib/context-confirm.js');

describe('cluster context confirmation', () => {
	test('logs cluster details and skips prompting when requested', async () => {
		logs.length = 0;
		confirmAnswer = false;

		await confirmClusterContext(kubeConfig(), true, { namespace: 'custom', action: 'upgrade' });

		expect(logs).toEqual([
			'info:Cluster-Context: test-context',
			'info:Server:          https://cluster.example',
			'info:Namespace:       custom',
			'step:Cluster confirmation skipped (--cluster-confirmed)'
		]);
	});

	test('allows a confirmed action', async () => {
		confirmAnswer = true;

		await expect(confirmClusterContext(kubeConfig(), false, { action: 'uninstall' })).resolves.toBeUndefined();
	});

	test('throws when the prompt is declined or cancelled', async () => {
		confirmAnswer = false;
		await expect(confirmClusterContext(kubeConfig(), false, { action: 'uninstall' })).rejects.toThrow('Uninstall aborted.');

		confirmAnswer = cancelled;
		await expect(confirmClusterContext(kubeConfig(), false, { action: 'installation' })).rejects.toThrow('Installation aborted.');
	});
});

function kubeConfig() {
	return {
		getCurrentContext: () => 'test-context',
		getCurrentCluster: () => ({ server: 'https://cluster.example' })
	} as never;
}
