import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';

// runPlatformReconcile orchestration: reconciler seams + getKubeConfig faked, runSteps runs for real.
// Verifies both reconcilers run in order with the same KubeConfig, and a thrown step is isolated.

const fakeKc = { tag: 'kc' } as unknown as KubeConfig;
const order: string[] = [];
let registryImpl: (kc: KubeConfig) => Promise<void> = async kc => {
	order.push(`registry:${(kc as unknown as { tag: string }).tag}`);
};
let prometheusImpl: (kc: KubeConfig) => Promise<void> = async kc => {
	order.push(`prometheus:${(kc as unknown as { tag: string }).tag}`);
};
let haImpl: (kc: KubeConfig) => Promise<void> = async kc => {
	order.push(`ha:${(kc as unknown as { tag: string }).tag}`);
};

mock.module('@kubwave/kube', () => ({ getKubeConfig: () => fakeKc }));
mock.module('~/modules/worker/jobs/platform/registry', () => ({ reconcileBuildRegistryApply: (kc: KubeConfig) => registryImpl(kc) }));
mock.module('~/modules/worker/jobs/platform/prometheus', () => ({ reconcilePlatformPrometheus: (kc: KubeConfig) => prometheusImpl(kc) }));
mock.module('~/modules/worker/jobs/platform/ha', () => ({ reconcileHaMode: (kc: KubeConfig) => haImpl(kc) }));

const { runPlatformReconcile } = await import('~/modules/worker/jobs/platform/job');

afterEach(() => {
	order.length = 0;
	registryImpl = async kc => {
		order.push(`registry:${(kc as unknown as { tag: string }).tag}`);
	};
	prometheusImpl = async kc => {
		order.push(`prometheus:${(kc as unknown as { tag: string }).tag}`);
	};
	haImpl = async kc => {
		order.push(`ha:${(kc as unknown as { tag: string }).tag}`);
	};
});

describe('runPlatformReconcile', () => {
	test('runs registry, prometheus, then ha, each with the shared KubeConfig', async () => {
		await runPlatformReconcile();
		expect(order).toEqual(['registry:kc', 'prometheus:kc', 'ha:kc']);
	});

	test('a failing prometheus step is isolated — ha still runs (best-effort tick)', async () => {
		prometheusImpl = async () => {
			order.push('prometheus:threw');
			throw new Error('boom');
		};
		await expect(runPlatformReconcile()).resolves.toBeUndefined();
		expect(order).toEqual(['registry:kc', 'prometheus:threw', 'ha:kc']);
	});

	test('a failing ha step does not throw out of the tick', async () => {
		haImpl = async () => {
			order.push('ha:threw');
			throw new Error('kaboom');
		};
		await expect(runPlatformReconcile()).resolves.toBeUndefined();
		expect(order).toEqual(['registry:kc', 'prometheus:kc', 'ha:threw']);
	});

	test('a failing registry step is isolated — later platform steps still run', async () => {
		registryImpl = async () => {
			order.push('registry:threw');
			throw new Error('oops');
		};
		await expect(runPlatformReconcile()).resolves.toBeUndefined();
		expect(order).toEqual(['registry:threw', 'prometheus:kc', 'ha:kc']);
	});
});
