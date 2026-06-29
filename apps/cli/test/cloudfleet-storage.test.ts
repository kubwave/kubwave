import { describe, expect, mock, test } from 'bun:test';
import { CoreV1Api, StorageV1Api } from '@kubernetes/client-node';
import { clackStub } from './support/clack-stub.js';

const cancelled = Symbol('cancelled');
let confirmResult: boolean | symbol = true;
const helmInstallCalls: unknown[][] = [];
let helmInstallError: Error | undefined;

mock.module('@clack/prompts', () => ({
	...clackStub(),
	confirm: mock(async () => confirmResult),
	isCancel: (value: unknown) => value === cancelled,
	spinner: () => ({ start: () => {}, stop: () => {} }),
	log: {
		warn: () => {},
		info: () => {},
		success: () => {}
	}
}));

mock.module('~/lib/dependencies.js', () => ({
	helmRepoAddAndInstall: mock(async (...args: unknown[]) => {
		helmInstallCalls.push(args);
		if (helmInstallError) throw helmInstallError;
	})
}));

const { confirmStorageInstall, ensureStorageClass, makeCloudfleetStorage, planCloudfleetStorage } =
	await import('../src/platforms/cloudfleet/storage.js');

describe('confirmStorageInstall', () => {
	test('resolves when user confirms', async () => {
		confirmResult = true;
		await expect(
			confirmStorageInstall({
				label: 'Hetzner CSI',
				install: {
					kind: 'helm',
					repo: { name: 'hcloud', url: 'https://charts.example.com' },
					chart: 'csi',
					release: 'csi-hetzner',
					namespace: 'csi',
					extraArgs: []
				},
				storageClass: 'hcloud-volumes',
				provisioner: 'csi.hetzner.cloud',
				nodeSelector: { 'cfke.io/provider': 'hetzner' }
			})
		).resolves.toBeUndefined();
	});

	test('throws UserCancelledError when cancelled', async () => {
		confirmResult = cancelled;
		await expect(
			confirmStorageInstall({
				label: 'Hetzner CSI',
				install: { kind: 'helm', repo: { name: '', url: '' }, chart: '', release: '', namespace: '', extraArgs: [] },
				storageClass: 'hcloud-volumes',
				provisioner: 'csi.hetzner.cloud',
				nodeSelector: { 'cfke.io/provider': 'hetzner' }
			})
		).rejects.toThrow('CSI installation cancelled.');
	});

	test('throws FatalCliError when declined', async () => {
		confirmResult = false;
		await expect(
			confirmStorageInstall({
				label: 'Hetzner CSI',
				install: { kind: 'helm', repo: { name: '', url: '' }, chart: '', release: '', namespace: '', extraArgs: [] },
				storageClass: 'hcloud-volumes',
				provisioner: 'csi.hetzner.cloud',
				nodeSelector: { 'cfke.io/provider': 'hetzner' }
			})
		).rejects.toThrow('CSI installation declined');
	});
});

describe('ensureStorageClass', () => {
	test('creates StorageClass when it does not exist', async () => {
		let created = false;
		const kc = {
			makeApiClient: () => ({
				readStorageClass: async () => {
					throw { code: 404 };
				},
				createStorageClass: async () => {
					created = true;
				}
			})
		} as never;

		const result = await ensureStorageClass(kc, {
			name: 'hcloud-volumes',
			provisioner: 'csi.hetzner.cloud',
			parameters: { type: 'nvme' }
		});
		expect(result).toBe(true);
		expect(created).toBe(true);
	});

	test('includes optional fields when provided', async () => {
		const created: unknown[] = [];
		const kc = {
			makeApiClient: () => ({
				readStorageClass: async () => {
					throw { code: 404 };
				},
				createStorageClass: async ({ body }: { body: unknown }) => {
					created.push(body);
				}
			})
		} as never;

		await ensureStorageClass(kc, {
			name: 'full-sc',
			provisioner: 'test.csi.io',
			parameters: { type: 'ssd' },
			reclaimPolicy: 'Retain',
			volumeBindingMode: 'WaitForFirstConsumer',
			allowVolumeExpansion: true
		});

		expect(created.length).toBe(1);
	});

	test('marks created StorageClass as default when isDefault is set', async () => {
		const created: Array<{ metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> } }> = [];
		const kc = {
			makeApiClient: () => ({
				readStorageClass: async () => {
					throw { code: 404 };
				},
				createStorageClass: async ({ body }: { body: never }) => {
					created.push(body);
				}
			})
		} as never;

		await ensureStorageClass(kc, { name: 'pd-ssd', provisioner: 'pd.csi.storage.gke.io', isDefault: true });

		expect(created).toHaveLength(1);
		expect(created[0]?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class']).toBe('true');
		// Ownership label so uninstall only deletes SCs kubwave created.
		expect(created[0]?.metadata?.labels?.['app.kubernetes.io/managed-by']).toBe('kubwave-cli');
	});

	test('does not add the default annotation when isDefault is unset', async () => {
		const created: Array<{ metadata?: { annotations?: Record<string, string> } }> = [];
		const kc = {
			makeApiClient: () => ({
				readStorageClass: async () => {
					throw { code: 404 };
				},
				createStorageClass: async ({ body }: { body: never }) => {
					created.push(body);
				}
			})
		} as never;

		await ensureStorageClass(kc, { name: 'plain-sc', provisioner: 'test.csi.io' });

		expect(created).toHaveLength(1);
		expect(created[0]?.metadata?.annotations).toBeUndefined();
	});

	test('retrofits the default annotation onto an existing SC when none is default', async () => {
		const patched: unknown[] = [];
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						readStorageClass: async () => ({ metadata: { name: 'pd-ssd' } }),
						listStorageClass: async () => ({ items: [{ metadata: { name: 'pd-ssd' } }] })
					};
				}
				// KubernetesObjectApi path
				return {
					setDefaultNamespace: () => {},
					patch: async (spec: unknown) => {
						patched.push(spec);
					}
				};
			}
		} as never;

		const result = await ensureStorageClass(kc, { name: 'pd-ssd', provisioner: 'pd.csi.storage.gke.io', isDefault: true });

		expect(result).toBe(true);
		expect(patched).toHaveLength(1);
		expect(patched[0]).toMatchObject({
			kind: 'StorageClass',
			metadata: { name: 'pd-ssd', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } }
		});
	});

	test('does not retrofit when another StorageClass is already default', async () => {
		let patchCalled = false;
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						readStorageClass: async () => ({ metadata: { name: 'pd-ssd' } }),
						listStorageClass: async () => ({
							items: [{ metadata: { name: 'other', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } } }]
						})
					};
				}
				return {
					setDefaultNamespace: () => {},
					patch: async () => {
						patchCalled = true;
					}
				};
			}
		} as never;

		const result = await ensureStorageClass(kc, { name: 'pd-ssd', provisioner: 'pd.csi.storage.gke.io', isDefault: true });

		expect(result).toBe(false);
		expect(patchCalled).toBe(false);
	});

	test('returns false when StorageClass already exists', async () => {
		const kc = {
			makeApiClient: () => ({
				readStorageClass: async () => ({ metadata: { name: 'existing-sc' } }),
				createStorageClass: async () => {
					throw new Error('should not create');
				}
			})
		} as never;

		const result = await ensureStorageClass(kc, { name: 'existing-sc', provisioner: 'test' });
		expect(result).toBe(false);
	});

	test('rethrows non-not-found errors', async () => {
		const kc = {
			makeApiClient: () => ({
				readStorageClass: async () => {
					throw new Error('forbidden');
				}
			})
		} as never;

		await expect(ensureStorageClass(kc, { name: 'test', provisioner: 'test' })).rejects.toThrow('forbidden');
	});
});

describe('planCloudfleetStorage', () => {
	test('returns use-storage-class when storageClass is set in opts', async () => {
		const kc = { makeApiClient: () => ({}) } as never;
		const result = await planCloudfleetStorage(kc, 'hetzner', { storageMode: 'auto', storageClass: 'my-sc' });
		expect(result).toEqual({ action: 'use-storage-class', storageClass: 'my-sc', decision: { storageClass: 'my-sc' } });
	});

	test('returns skip when storageMode is skip', async () => {
		const kc = { makeApiClient: () => ({}) } as never;
		const result = await planCloudfleetStorage(kc, 'hetzner', { storageMode: 'skip' });
		expect(result).toEqual({ action: 'skip', decision: {} });
	});

	test('returns use-default when a default StorageClass exists', async () => {
		const kc = {
			makeApiClient: () => ({
				listStorageClass: async () => ({
					items: [
						{
							metadata: {
								name: 'default-sc',
								annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' }
							}
						}
					]
				})
			})
		} as never;

		const result = await planCloudfleetStorage(kc, 'hetzner', { storageMode: 'auto' });
		expect(result).toEqual({ action: 'use-default', storageClass: 'default-sc', decision: {} });
	});

	test('returns install-csi when no default StorageClass', async () => {
		let storageApiCalled = false;
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					storageApiCalled = true;
					return {
						listStorageClass: async () => ({ items: [] })
					};
				}
				if (clientClass === CoreV1Api) {
					return {
						listNode: async () => ({ items: [] }),
						readNamespacedSecret: async () => ({ data: { token: 'encoded-token' } })
					};
				}
				throw new Error(`unexpected api client: ${String(clientClass)}`);
			}
		} as never;

		const result = await planCloudfleetStorage(kc, 'hetzner', { storageMode: 'auto' });
		expect(storageApiCalled).toBe(true);
		expect(result.action).toBe('install-csi');
		if (result.action !== 'install-csi') throw new Error(`unexpected storage action: ${result.action}`);
		expect(result.provider).toBe('hetzner');
		expect(result.decision).toEqual({ storageClass: 'hcloud-volumes', nodeSelector: { 'cfke.io/provider': 'hetzner' } });
	});

	test('throws when a provider prerequisite secret is missing', async () => {
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						listStorageClass: async () => ({ items: [] })
					};
				}
				if (clientClass === CoreV1Api) {
					return {
						listNode: async () => ({ items: [{ metadata: { labels: { 'cfke.io/provider': 'hetzner' } } }] }),
						readNamespacedSecret: async () => {
							throw { code: 404 };
						}
					};
				}
				throw new Error(`unexpected api client: ${String(clientClass)}`);
			}
		} as never;

		await expect(planCloudfleetStorage(kc, 'hetzner', { storageMode: 'auto' })).rejects.toThrow('Missing prerequisite');
	});

	test('plans bootstrap from Cloudfleet fleet secret when Hetzner CSI secret is missing', async () => {
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						listStorageClass: async () => ({ items: [] })
					};
				}
				if (clientClass === CoreV1Api) {
					return {
						listNode: async () => ({ items: [{ metadata: { labels: { 'cfke.io/provider': 'hetzner' } } }] }),
						readNamespacedSecret: async ({ name }: { name: string }) => {
							if (name === 'hcloud') throw { code: 404 };
							if (name === 'fleet-secrets') return { data: { hetzner: 'encoded-token' } };
							throw new Error(`unexpected secret: ${name}`);
						}
					};
				}
				throw new Error(`unexpected api client: ${String(clientClass)}`);
			}
		} as never;

		const result = await planCloudfleetStorage(kc, 'hetzner', { storageMode: 'auto' });

		expect(result.action).toBe('install-csi');
		if (result.action !== 'install-csi') throw new Error(`unexpected storage action: ${result.action}`);
		expect(result.prerequisiteBootstrap).toMatchObject({
			targetKey: 'token',
			source: { namespace: 'kube-system', name: 'fleet-secrets', key: 'hetzner' }
		});
	});
});

describe('makeCloudfleetStorage', () => {
	test('returns storageClass decision when storageClass is set', async () => {
		const ensure = makeCloudfleetStorage('hetzner');
		const result = await ensure({ makeApiClient: () => ({}) } as never, { storageMode: 'auto', storageClass: 'my-sc' });
		expect(result).toEqual({ storageClass: 'my-sc' });
	});

	test('returns empty decision when storageMode is skip', async () => {
		const ensure = makeCloudfleetStorage('hetzner');
		const result = await ensure({ makeApiClient: () => ({}) } as never, { storageMode: 'skip' });
		expect(result).toEqual({});
	});

	test('returns empty decision when default StorageClass exists', async () => {
		const ensure = makeCloudfleetStorage('hetzner');
		const kc = {
			makeApiClient: () => ({
				listStorageClass: async () => ({
					items: [
						{
							metadata: { name: 'default-sc', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } }
						}
					]
				})
			})
		} as never;

		const result = await ensure(kc, { storageMode: 'auto' });
		expect(result).toEqual({});
	});

	test('installs CSI and creates the provider StorageClass when needed', async () => {
		confirmResult = true;
		helmInstallCalls.length = 0;
		helmInstallError = undefined;
		const ensure = makeCloudfleetStorage('aws');
		const createdStorageClasses: unknown[] = [];
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						listStorageClass: async () => ({ items: [] }),
						readStorageClass: async () => {
							throw { code: 404 };
						},
						createStorageClass: async ({ body }: { body: unknown }) => {
							createdStorageClasses.push(body);
						}
					};
				}
				if (clientClass === CoreV1Api) {
					return {
						listNode: async () => ({ items: [{ spec: { providerID: 'aws:///us-east-1/i-123' } }] })
					};
				}
				throw new Error(`unexpected api client: ${String(clientClass)}`);
			}
		} as never;

		const result = await ensure(kc, { storageMode: 'auto' });

		expect(result).toEqual({ storageClass: 'ebs-sc', nodeSelector: { 'cfke.io/provider': 'aws' } });
		expect(helmInstallCalls).toHaveLength(1);
		expect(helmInstallCalls[0]?.[1]).toBe('aws-ebs-csi-driver/aws-ebs-csi-driver');
		expect(createdStorageClasses).toHaveLength(1);
		expect(createdStorageClasses[0]).toMatchObject({
			metadata: { name: 'ebs-sc', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
			provisioner: 'ebs.csi.aws.com',
			allowVolumeExpansion: true
		});
	});

	test('logs present prerequisites while installing provider CSI', async () => {
		confirmResult = true;
		helmInstallCalls.length = 0;
		helmInstallError = undefined;
		const ensure = makeCloudfleetStorage('hetzner');
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						listStorageClass: async () => ({ items: [] })
					};
				}
				if (clientClass === CoreV1Api) {
					return {
						listNode: async () => ({ items: [{ metadata: { labels: { 'cfke.io/provider': 'hetzner' } } }] }),
						readNamespacedSecret: async () => ({ metadata: { name: 'hcloud' }, data: { token: 'encoded-token' } })
					};
				}
				throw new Error(`unexpected api client: ${String(clientClass)}`);
			}
		} as never;

		const result = await ensure(kc, { storageMode: 'auto' });

		expect(result).toEqual({ storageClass: 'hcloud-volumes', nodeSelector: { 'cfke.io/provider': 'hetzner' } });
		expect(helmInstallCalls).toHaveLength(1);
	});

	test('creates hcloud secret from Cloudfleet fleet secret before installing Hetzner CSI', async () => {
		confirmResult = true;
		helmInstallCalls.length = 0;
		helmInstallError = undefined;
		const ensure = makeCloudfleetStorage('hetzner');
		const createdSecrets: unknown[] = [];
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						listStorageClass: async () => ({ items: [] })
					};
				}
				if (clientClass === CoreV1Api) {
					return {
						listNode: async () => ({ items: [{ metadata: { labels: { 'cfke.io/provider': 'hetzner' } } }] }),
						readNamespacedSecret: async ({ name }: { name: string }) => {
							if (name === 'hcloud') throw { code: 404 };
							if (name === 'fleet-secrets') return { data: { hetzner: 'encoded-token' } };
							throw new Error(`unexpected secret: ${name}`);
						},
						createNamespacedSecret: async ({ body }: { body: unknown }) => {
							createdSecrets.push(body);
						}
					};
				}
				throw new Error(`unexpected api client: ${String(clientClass)}`);
			}
		} as never;

		const result = await ensure(kc, { storageMode: 'auto' });

		expect(result).toEqual({ storageClass: 'hcloud-volumes', nodeSelector: { 'cfke.io/provider': 'hetzner' } });
		expect(createdSecrets).toHaveLength(1);
		expect(createdSecrets[0]).toMatchObject({
			metadata: { namespace: 'kube-system', name: 'hcloud' },
			type: 'Opaque',
			data: { token: 'encoded-token' }
		});
		expect(helmInstallCalls).toHaveLength(1);
	});

	test('propagates CSI helm install failures', async () => {
		confirmResult = true;
		helmInstallCalls.length = 0;
		helmInstallError = new Error('helm install failed');
		const ensure = makeCloudfleetStorage('aws');
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						listStorageClass: async () => ({ items: [] })
					};
				}
				if (clientClass === CoreV1Api) {
					return {
						listNode: async () => ({ items: [{ spec: { providerID: 'aws:///us-east-1/i-123' } }] })
					};
				}
				throw new Error(`unexpected api client: ${String(clientClass)}`);
			}
		} as never;

		await expect(ensure(kc, { storageMode: 'auto' })).rejects.toThrow('helm install failed');
		helmInstallError = undefined;
	});

	test('propagates StorageClass creation failures after CSI install', async () => {
		confirmResult = true;
		helmInstallCalls.length = 0;
		helmInstallError = undefined;
		const ensure = makeCloudfleetStorage('aws');
		const kc = {
			makeApiClient: (clientClass: unknown) => {
				if (clientClass === StorageV1Api) {
					return {
						listStorageClass: async () => ({ items: [] }),
						readStorageClass: async () => {
							throw { code: 404 };
						},
						createStorageClass: async () => {
							throw new Error('storageclass forbidden');
						}
					};
				}
				if (clientClass === CoreV1Api) {
					return {
						listNode: async () => ({ items: [{ spec: { providerID: 'aws:///us-east-1/i-123' } }] })
					};
				}
				throw new Error(`unexpected api client: ${String(clientClass)}`);
			}
		} as never;

		await expect(ensure(kc, { storageMode: 'auto' })).rejects.toThrow('storageclass forbidden');
	});
});
