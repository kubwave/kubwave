import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { KubeConfig, V1StorageClass } from '@kubernetes/client-node';
import { clackStub } from './support/clack-stub.js';

const warnings: string[] = [];
const infos: string[] = [];

mock.module('@clack/prompts', () => ({
	...clackStub(),
	log: {
		...clackStub().log,
		warn: (message: string) => {
			warnings.push(message);
		},
		info: (message: string) => {
			infos.push(message);
		}
	}
}));

const { ensureK3sStorage, K3S_LOCAL_PATH_PROVISIONER } = await import('../src/platforms/k3s/storage.js');

const localPath: V1StorageClass = {
	metadata: { name: 'local-path', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
	provisioner: K3S_LOCAL_PATH_PROVISIONER
};

function kubeConfigWith(storageClasses: V1StorageClass[], nodeCount = 1): KubeConfig {
	return {
		makeApiClient: () => ({
			listStorageClass: async () => ({ items: storageClasses }),
			listNode: async () => ({ items: Array.from({ length: nodeCount }, (_, i) => ({ metadata: { name: `node-${i}` } })) })
		})
	} as never;
}

describe('ensureK3sStorage', () => {
	beforeEach(() => {
		warnings.length = 0;
		infos.length = 0;
	});

	test('uses the default local-path class on a single node without a multi-node warning', async () => {
		const decision = await ensureK3sStorage(kubeConfigWith([localPath]), { storageMode: 'auto' });
		expect(decision.storageClass).toBe('local-path');
		expect(warnings).toEqual([]);
		expect(infos.join('\n')).toContain('volume expansion');
	});

	test('warns that local-path pins volumes to one node on a multi-node cluster', async () => {
		const decision = await ensureK3sStorage(kubeConfigWith([localPath], 3), { storageMode: 'auto' });
		expect(decision.storageClass).toBe('local-path');
		expect(warnings.join('\n')).toContain('Longhorn');
	});

	test('uses an operator-chosen default class as-is', async () => {
		const longhorn: V1StorageClass = {
			metadata: { name: 'longhorn', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
			provisioner: 'driver.longhorn.io',
			allowVolumeExpansion: true
		};
		const nonDefault: V1StorageClass = { ...localPath, metadata: { name: 'local-path' } };
		const decision = await ensureK3sStorage(kubeConfigWith([nonDefault, longhorn], 3), { storageMode: 'auto' });
		expect(decision.storageClass).toBe('longhorn');
		expect(warnings).toEqual([]);
		expect(infos).toEqual([]);
	});

	test('throws when the cluster has no default StorageClass', async () => {
		const nonDefault: V1StorageClass = { ...localPath, metadata: { name: 'local-path' } };
		await expect(ensureK3sStorage(kubeConfigWith([nonDefault]), { storageMode: 'auto' })).rejects.toThrow('--storage-class');
	});

	test('an explicit --storage-class flag wins over detection', async () => {
		const decision = await ensureK3sStorage(kubeConfigWith([localPath]), { storageMode: 'auto', storageClass: 'my-sc' });
		expect(decision.storageClass).toBe('my-sc');
	});

	test('storage=skip returns no StorageClass', async () => {
		const decision = await ensureK3sStorage(kubeConfigWith([localPath]), { storageMode: 'skip' });
		expect(decision.storageClass).toBeUndefined();
	});
});
