import { describe, expect, mock, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import { clackStub } from './support/clack-stub.js';

const warnings: string[] = [];

mock.module('@clack/prompts', () => ({
	...clackStub(),
	log: {
		...clackStub().log,
		warn: (message: string) => {
			warnings.push(message);
		}
	}
}));

const { ensureInfomaniakStorage, INFOMANIAK_DEFAULT_STORAGE_CLASS, INFOMANIAK_RETAIN_STORAGE_CLASS } =
	await import('../src/platforms/infomaniak/storage.js');

function kubeConfigWith(existing: string[]): KubeConfig {
	return {
		makeApiClient: () => ({
			readStorageClass: async ({ name }: { name: string }) => {
				if (!existing.includes(name)) throw { code: 404 };
				return { metadata: { name } };
			}
		})
	} as never;
}

describe('ensureInfomaniakStorage', () => {
	test('prefers the Delete-reclaim Cinder StorageClass', async () => {
		const kc = kubeConfigWith([INFOMANIAK_DEFAULT_STORAGE_CLASS, INFOMANIAK_RETAIN_STORAGE_CLASS]);
		const decision = await ensureInfomaniakStorage(kc, { storageMode: 'auto' });
		expect(decision.storageClass).toBe(INFOMANIAK_DEFAULT_STORAGE_CLASS);
	});

	test('falls back to the Retain StorageClass with a warning when Delete is absent', async () => {
		warnings.length = 0;
		const kc = kubeConfigWith([INFOMANIAK_RETAIN_STORAGE_CLASS]);
		const decision = await ensureInfomaniakStorage(kc, { storageMode: 'auto' });
		expect(decision.storageClass).toBe(INFOMANIAK_RETAIN_STORAGE_CLASS);
		expect(warnings.join('\n')).toContain(INFOMANIAK_RETAIN_STORAGE_CLASS);
	});

	test('throws when no Cinder StorageClass exists', async () => {
		const kc = kubeConfigWith([]);
		await expect(ensureInfomaniakStorage(kc, { storageMode: 'auto' })).rejects.toThrow('cinder.csi.openstack.org');
	});

	test('an explicit --storage-class flag wins over detection', async () => {
		const kc = kubeConfigWith([INFOMANIAK_DEFAULT_STORAGE_CLASS]);
		const decision = await ensureInfomaniakStorage(kc, { storageMode: 'auto', storageClass: 'my-sc' });
		expect(decision.storageClass).toBe('my-sc');
	});

	test('storage=skip returns no StorageClass', async () => {
		const kc = kubeConfigWith([INFOMANIAK_DEFAULT_STORAGE_CLASS]);
		const decision = await ensureInfomaniakStorage(kc, { storageMode: 'skip' });
		expect(decision.storageClass).toBeUndefined();
	});
});
