import { describe, expect, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import { assertBundledTraefikDisabled } from '../src/platforms/k3s/preflight.js';
import { FatalCliError } from '../src/lib/errors.js';

function kubeConfigWith(getNamespacedCustomObject: (args: Record<string, string>) => Promise<unknown>): KubeConfig {
	return { makeApiClient: () => ({ getNamespacedCustomObject }) } as never;
}

describe('assertBundledTraefikDisabled', () => {
	test('passes when the bundled Traefik HelmChart is absent', async () => {
		const kc = kubeConfigWith(async () => {
			throw { code: 404 };
		});
		await expect(assertBundledTraefikDisabled(kc)).resolves.toBeUndefined();
	});

	test('looks up the k3s HelmChart kube-system/traefik', async () => {
		let requested: Record<string, string> | undefined;
		const kc = kubeConfigWith(async args => {
			requested = args;
			throw { code: 404 };
		});
		await assertBundledTraefikDisabled(kc);
		expect(requested).toEqual({ group: 'helm.cattle.io', version: 'v1', namespace: 'kube-system', plural: 'helmcharts', name: 'traefik' });
	});

	test('fails with disable instructions while the bundled Traefik is enabled', async () => {
		const kc = kubeConfigWith(async () => ({ metadata: { name: 'traefik', namespace: 'kube-system' } }));
		const result = assertBundledTraefikDisabled(kc);
		await expect(result).rejects.toBeInstanceOf(FatalCliError);
		await expect(assertBundledTraefikDisabled(kc)).rejects.toThrow('--disable=traefik');
	});

	test('surfaces unexpected API errors', async () => {
		const kc = kubeConfigWith(async () => {
			throw { code: 403 };
		});
		await expect(assertBundledTraefikDisabled(kc)).rejects.toEqual({ code: 403 });
	});
});
