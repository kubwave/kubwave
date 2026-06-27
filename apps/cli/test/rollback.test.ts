import { describe, expect, mock, test } from 'bun:test';
import { AppsV1Api } from '@kubernetes/client-node';
import * as realHelm from '../src/lib/helm.js';

const execHelmCalls: string[][] = [];
let execHelmResult = { stdout: '', stderr: '', exitCode: 0 };

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	execHelm: async (args: string[]) => {
		execHelmCalls.push(args);
		return execHelmResult;
	}
}));

const { captureImageTags, helmRollback, waitForRollout } = await import('../src/lib/rollback.js');

describe('rollback helpers', () => {
	test('captures deployment and statefulset image tags', async () => {
		const kc = kubeConfig({
			listNamespacedDeployment: async () => ({
				items: [
					{ metadata: { name: 'console' }, spec: { template: { spec: { containers: [{ image: 'console:v1' }] } } } },
					{ metadata: { name: 'empty' }, spec: { template: { spec: { containers: [] } } } }
				]
			}),
			listNamespacedStatefulSet: async () => ({
				items: [{ metadata: { name: 'postgres' }, spec: { template: { spec: { containers: [{ image: 'postgres:v1' }] } } } }]
			})
		});

		await expect(captureImageTags(kc)).resolves.toEqual({ console: 'console:v1', postgres: 'postgres:v1' });
	});

	test('waits for deployment and statefulset rollout success', async () => {
		const reporter = recordingReporter();
		const kc = kubeConfig({
			listNamespacedDeployment: async () => ({ items: [{ metadata: { name: 'console' } }] }),
			listNamespacedStatefulSet: async () => ({ items: [{ metadata: { name: 'postgres' } }] }),
			readNamespacedDeployment: async () => ({ spec: { replicas: 2 }, status: { readyReplicas: 2, updatedReplicas: 2 } }),
			readNamespacedStatefulSet: async () => ({ spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } })
		});

		await expect(waitForRollout(kc, reporter)).resolves.toBe(true);
		expect(reporter.events).toContain('succeed:Rollout complete: deployment/console');
		expect(reporter.events).toContain('succeed:Rollout complete: statefulset/postgres');
	});

	test('returns false and reports a timeout when a target is not ready', async () => {
		const realNow = Date.now;
		const realSleep = Bun.sleep;
		Bun.sleep = mock(async () => {});
		const reporter = recordingReporter();
		const kc = kubeConfig({
			listNamespacedDeployment: async () => ({ items: [{ metadata: { name: 'console' } }] }),
			listNamespacedStatefulSet: async () => ({ items: [] }),
			readNamespacedDeployment: async () => ({ spec: { replicas: 1 }, status: { readyReplicas: 0, updatedReplicas: 0 } })
		});

		try {
			let calls = 0;
			Date.now = mock(() => (calls++ === 0 ? 0 : 5 * 60 * 1000 + 1));
			await expect(waitForRollout(kc, reporter)).resolves.toBe(false);
			expect(reporter.events).toContain('fail:Rollout timeout: deployment/console:Timed out after 300s');
		} finally {
			Date.now = realNow;
			Bun.sleep = realSleep;
		}
	});

	test('runs helm rollback and reports success or failure', async () => {
		const reporter = recordingReporter();
		execHelmCalls.length = 0;
		execHelmResult = { stdout: '', stderr: '', exitCode: 0 };

		await expect(helmRollback(reporter)).resolves.toBe(true);
		expect(execHelmCalls[0]).toEqual(['rollback', 'kubwave', '--namespace', 'kubwave', '--wait', '--timeout', '5m']);
		expect(reporter.events).toContain('succeed:Helm rollback successful');

		execHelmResult = { stdout: '', stderr: 'bad release', exitCode: 1 };
		await expect(helmRollback(reporter)).resolves.toBe(false);
		expect(reporter.events).toContain('fail:Helm rollback failed:bad release');
	});
});

function kubeConfig(api: unknown) {
	return {
		makeApiClient(kind: unknown) {
			if (kind !== AppsV1Api) throw new Error('unexpected api');
			return api;
		}
	} as never;
}

function recordingReporter() {
	const events: string[] = [];
	return {
		events,
		start: (phase: string) => events.push(`start:${phase}`),
		succeed: (phase: string) => events.push(`succeed:${phase}`),
		fail: (phase: string, error: string) => events.push(`fail:${phase}:${error}`),
		log: (message: string) => events.push(`log:${message}`),
		finish: (status: string, message: string) => {
			events.push(`finish:${status}:${message}`);
		}
	};
}
