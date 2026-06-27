import { describe, expect, test } from 'bun:test';
import { readVersionMarker, writeVersionMarker } from '../src/lib/version-marker.js';
import { APP_LABELS, APP_NAMESPACE, PLATFORM_CONFIGMAP_NAME } from '../src/lib/constants.js';

describe('version marker', () => {
	test('reads marker data with defaults and a stable fallback channel', async () => {
		const api = {
			readNamespacedConfigMap: async () => ({
				data: {
					current_version: 'v1.0.0',
					installed_at: 'yesterday',
					installed_by: 'job',
					channel: 'unsupported'
				}
			})
		};

		await expect(readVersionMarker(kubeConfig(api))).resolves.toEqual({
			currentVersion: 'v1.0.0',
			installedAt: 'yesterday',
			installedBy: 'job',
			channel: 'stable'
		});
	});

	test('returns null when the marker configmap is missing', async () => {
		const api = {
			readNamespacedConfigMap: async () => {
				throw { code: 404 };
			}
		};

		await expect(readVersionMarker(kubeConfig(api))).resolves.toBeNull();
	});

	test('reads persisted install-state fields from marker data', async () => {
		const api = {
			readNamespacedConfigMap: async () => ({
				data: {
					current_version: 'v1.0.0',
					installed_at: 'yesterday',
					installed_by: 'cli',
					channel: 'preview',
					domain: 'app.example.com',
					image_registry: 'registry.example.com/kubwave',
					registry_host: 'registry.app.example.com',
					platform_id: 'cloudfleet-hetzner',
					ingress_class_name: 'traefik',
					ingress_controller_namespace: 'traefik',
					storage_class: 'fast',
					node_selector_json: '{"cfke.io/provider":"hetzner"}',
					traefik_values_json: '{"nodeSelector":{"cfke.io/provider":"hetzner"}}'
				}
			})
		};

		await expect(readVersionMarker(kubeConfig(api))).resolves.toMatchObject({
			currentVersion: 'v1.0.0',
			channel: 'preview',
			installState: {
				domain: 'app.example.com',
				imageRegistry: 'registry.example.com/kubwave',
				registryHost: 'registry.app.example.com',
				platformId: 'cloudfleet-hetzner',
				ingressClassName: 'traefik',
				ingressControllerNamespace: 'traefik',
				storageClass: 'fast',
				nodeSelector: { 'cfke.io/provider': 'hetzner' },
				traefikValues: { nodeSelector: { 'cfke.io/provider': 'hetzner' } },
				dependencies: {
					traefik: {
						namespace: 'traefik',
						ingressClassName: 'traefik',
						helmValues: {
							nodeSelector: { 'cfke.io/provider': 'hetzner' }
						}
					},
					certManager: {}
				}
			}
		});
	});

	test('rethrows non-not-found read errors', async () => {
		const api = {
			readNamespacedConfigMap: async () => {
				throw { code: 500 };
			}
		};

		await expect(readVersionMarker(kubeConfig(api))).rejects.toEqual({ code: 500 });
	});

	test('replaces an existing marker configmap', async () => {
		const calls: unknown[] = [];
		const api = {
			readNamespacedConfigMap: async (args: unknown) => calls.push(['read', args]),
			replaceNamespacedConfigMap: async (args: unknown) => calls.push(['replace', args])
		};

		await writeVersionMarker(kubeConfig(api), 'v1.2.3', 'cli', 'preview');

		expect(calls[0]).toEqual(['read', { name: PLATFORM_CONFIGMAP_NAME, namespace: APP_NAMESPACE }]);
		expect(calls[1]).toMatchObject([
			'replace',
			{
				name: PLATFORM_CONFIGMAP_NAME,
				namespace: APP_NAMESPACE,
				body: {
					metadata: { name: PLATFORM_CONFIGMAP_NAME, namespace: APP_NAMESPACE, labels: APP_LABELS },
					data: { current_version: 'v1.2.3', installed_by: 'cli', channel: 'preview' }
				}
			}
		]);
	});

	test('creates the marker configmap when it does not exist', async () => {
		const calls: unknown[] = [];
		const api = {
			readNamespacedConfigMap: async () => {
				throw { code: 404 };
			},
			createNamespacedConfigMap: async (args: unknown) => calls.push(args)
		};

		await writeVersionMarker(kubeConfig(api), 'v1.2.3');

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			namespace: APP_NAMESPACE,
			body: {
				metadata: { name: PLATFORM_CONFIGMAP_NAME, namespace: APP_NAMESPACE, labels: APP_LABELS },
				data: { current_version: 'v1.2.3', installed_by: 'cli', channel: 'stable' }
			}
		});
	});

	test('writes install-state fields into marker data', async () => {
		const calls: unknown[] = [];
		const api = {
			readNamespacedConfigMap: async () => {
				throw { code: 404 };
			},
			createNamespacedConfigMap: async (args: unknown) => calls.push(args)
		};

		await writeVersionMarker(kubeConfig(api), 'v1.2.3', 'cli', 'stable', {
			domain: 'app.example.com',
			imageRegistry: 'registry.example.com/kubwave',
			registryHost: 'registry.app.example.com',
			platformId: 'cloudfleet-hetzner',
			ingressClassName: 'traefik',
			ingressControllerNamespace: 'traefik',
			storageClass: 'fast',
			nodeSelector: { 'cfke.io/provider': 'hetzner' },
			traefikValues: { nodeSelector: { 'cfke.io/provider': 'hetzner' } },
			dependencies: {
				traefik: {
					kind: 'traefik',
					namespace: 'traefik',
					releaseName: 'traefik',
					ingressClassName: 'traefik',
					helmValues: { nodeSelector: { 'cfke.io/provider': 'hetzner' } }
				},
				certManager: {},
				cnpg: {}
			}
		});

		expect(calls[0]).toMatchObject({
			body: {
				data: {
					current_version: 'v1.2.3',
					domain: 'app.example.com',
					image_registry: 'registry.example.com/kubwave',
					registry_host: 'registry.app.example.com',
					platform_id: 'cloudfleet-hetzner',
					storage_class: 'fast',
					node_selector_json: '{"cfke.io/provider":"hetzner"}',
					dependencies_json:
						'{"traefik":{"kind":"traefik","namespace":"traefik","releaseName":"traefik","ingressClassName":"traefik","helmValues":{"ingressClass":{"enabled":true,"isDefaultClass":true},"nodeSelector":{"cfke.io/provider":"hetzner"}}},"certManager":{},"cnpg":{}}'
				}
			}
		});

		// Legacy per-dependency keys are no longer written — dependencies_json carries this state
		// (decodeInstallStateData still reads the old keys for old markers).
		const writtenData = (calls[0] as { body: { data: Record<string, string> } }).body.data;
		expect(writtenData['ingress_class_name']).toBeUndefined();
		expect(writtenData['ingress_controller_namespace']).toBeUndefined();
		expect(writtenData['traefik_values_json']).toBeUndefined();
	});

	test('preserves existing install-state fields when updating only version metadata', async () => {
		const calls: unknown[] = [];
		const api = {
			readNamespacedConfigMap: async () => ({
				data: {
					domain: 'app.example.com',
					image_registry: 'registry.example.com/kubwave'
				}
			}),
			replaceNamespacedConfigMap: async (args: unknown) => calls.push(args)
		};

		await writeVersionMarker(kubeConfig(api), 'v1.2.4');

		expect(calls[0]).toMatchObject({
			body: {
				data: {
					current_version: 'v1.2.4',
					domain: 'app.example.com',
					image_registry: 'registry.example.com/kubwave'
				}
			}
		});
	});

	test('rethrows non-not-found write errors', async () => {
		const api = {
			readNamespacedConfigMap: async () => {
				throw { code: 500 };
			}
		};

		await expect(writeVersionMarker(kubeConfig(api), 'v1.2.3')).rejects.toEqual({ code: 500 });
	});
});

function kubeConfig(api: unknown) {
	return {
		makeApiClient() {
			return api;
		}
	} as never;
}
