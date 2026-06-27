import { describe, expect, mock, test } from 'bun:test';
import { AppsV1Api, type KubeConfig } from '@kubernetes/client-node';

mock.module('@kubwave/db', () => ({
	db: {},
	updateRuns: {}
}));

const { imageRegistryFromImage, resolveUpdateImageRegistry } = await import('~/modules/worker/jobs/updates/registry');

describe('update image registry resolution', () => {
	test('parses registry prefixes from workload images', () => {
		expect(imageRegistryFromImage('ghcr.io/acme/worker:1.2.3', 'worker')).toBe('ghcr.io/acme');
		expect(imageRegistryFromImage('registry.example.com:5000/team/api:1.2.3', 'api')).toBe('registry.example.com:5000/team');
		expect(imageRegistryFromImage('worker:dev', 'worker')).toBeNull();
	});

	test('prefers the persisted platform marker registry', async () => {
		const core = {
			readNamespacedConfigMap: async () => ({ data: { image_registry: 'ghcr.io/acme' } })
		};
		const kc = {
			makeApiClient: () => {
				throw new Error('deployment fallback should not be used');
			}
		} as unknown as KubeConfig;

		await expect(resolveUpdateImageRegistry(kc, core as never, 'kubwave')).resolves.toBe('ghcr.io/acme');
	});

	test('falls back to the live worker deployment image registry', async () => {
		const core = {
			readNamespacedConfigMap: async () => {
				throw { code: 404 };
			}
		};
		const apps = {
			readNamespacedDeployment: async ({ name }: { name: string }) => ({
				spec: {
					template: {
						spec: {
							containers: [{ name, image: `registry.example.com/team/${name}:1.2.3` }]
						}
					}
				}
			})
		};
		const kc = { makeApiClient: (klass: unknown) => (klass === AppsV1Api ? apps : {}) } as unknown as KubeConfig;

		await expect(resolveUpdateImageRegistry(kc, core as never, 'kubwave')).resolves.toBe('registry.example.com/team');
	});

	test('skips a missing (404) deployment and resolves from the next workload', async () => {
		const core = { readNamespacedConfigMap: async () => ({ data: {} }) }; // no marker → falls through to deployments
		const apps = {
			readNamespacedDeployment: async ({ name }: { name: string }) => {
				if (name === 'worker') throw { code: 404 }; // worker deployment absent
				return { spec: { template: { spec: { containers: [{ name, image: `registry.example.com/team/${name}:9` }] } } } };
			}
		};
		const kc = { makeApiClient: (klass: unknown) => (klass === AppsV1Api ? apps : {}) } as unknown as KubeConfig;
		await expect(resolveUpdateImageRegistry(kc, core as never, 'kubwave')).resolves.toBe('registry.example.com/team');
	});

	test('rethrows a non-404 deployment read error', async () => {
		const core = { readNamespacedConfigMap: async () => ({ data: {} }) };
		const apps = {
			readNamespacedDeployment: async () => {
				throw { code: 500, message: 'apiserver down' };
			}
		};
		const kc = { makeApiClient: (klass: unknown) => (klass === AppsV1Api ? apps : {}) } as unknown as KubeConfig;
		await expect(resolveUpdateImageRegistry(kc, core as never, 'kubwave')).rejects.toMatchObject({ code: 500 });
	});

	test('throws when neither the marker nor any workload image yields a registry', async () => {
		const core = { readNamespacedConfigMap: async () => ({ data: {} }) };
		const apps = {
			readNamespacedDeployment: async () => {
				throw { code: 404 };
			}
		};
		const kc = { makeApiClient: (klass: unknown) => (klass === AppsV1Api ? apps : {}) } as unknown as KubeConfig;
		await expect(resolveUpdateImageRegistry(kc, core as never, 'kubwave')).rejects.toThrow(/Could not determine update image registry/);
	});
});
