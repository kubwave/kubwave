import { describe, expect, test } from 'bun:test';
import type { AppsV1Api, CoreV1Api } from '@kubernetes/client-node';

// ops.ts uses only pure kube helpers, so the real @kubwave/kube loads (no mocking).
// Conflict = err.code 409, not-found = err.code 404.
import {
	createIgnoreConflict,
	deleteIgnoreMissing,
	notFoundToNull,
	readConfigMapOrNull,
	readDeploymentOrNull,
	readHPAOrNull,
	readIngressOrNull,
	readPVCOrNull,
	readSecretOrNull,
	readServiceOrNull,
	replaceWithRetry,
	retryOnConflict,
	rolloutFailureMessage,
	unhealthyReason
} from '~/shared/cluster/ops';

const conflict = { code: 409 };
const notFound = { code: 404 };
const boom = { code: 500 };

describe('replaceWithRetry', () => {
	test('reads, carries over, and replaces once on success', async () => {
		let replaced: unknown;
		await replaceWithRetry({
			label: 'Thing x',
			read: async (): Promise<{ metadata: { resourceVersion: string | undefined } }> => ({ metadata: { resourceVersion: '7' } }),
			build: () => ({ metadata: { resourceVersion: undefined } }),
			carryOver: (fresh, _desired) => ({ metadata: { resourceVersion: fresh.metadata?.resourceVersion } }),
			replace: async body => {
				replaced = body;
			}
		});
		// carryOver fed the fresh resourceVersion into the replaced body.
		expect(replaced).toEqual({ metadata: { resourceVersion: '7' } });
	});

	test('re-reads and retries after a 409, then succeeds', async () => {
		let reads = 0;
		let replaceCalls = 0;
		await replaceWithRetry({
			label: 'Thing x',
			read: async () => {
				reads++;
				return { metadata: { resourceVersion: String(reads) } };
			},
			build: () => ({ metadata: {} }),
			carryOver: (_fresh, desired) => desired,
			replace: async () => {
				replaceCalls++;
				if (replaceCalls === 1) throw conflict;
			}
		});
		expect(reads).toBe(2);
		expect(replaceCalls).toBe(2);
	});

	test('throws the last conflict after exhausting maxAttempts', async () => {
		await expect(
			replaceWithRetry({
				label: 'Thing x',
				maxAttempts: 2,
				read: async () => ({ metadata: {} }),
				build: () => ({ metadata: {} }),
				carryOver: (_f, d) => d,
				replace: async () => {
					throw conflict;
				}
			})
		).rejects.toBe(conflict);
	});

	test('throws "disappeared" when the read returns null', async () => {
		await expect(
			replaceWithRetry({
				label: 'Service svc-1',
				read: async () => null,
				build: () => ({ metadata: {} }),
				carryOver: (_f, d) => d,
				replace: async () => {}
			})
		).rejects.toThrow('Service svc-1 disappeared during replace retry');
	});

	test('propagates a non-conflict replace error immediately', async () => {
		await expect(
			replaceWithRetry({
				label: 'Thing x',
				read: async () => ({ metadata: {} }),
				build: () => ({ metadata: {} }),
				carryOver: (_f, d) => d,
				replace: async () => {
					throw boom;
				}
			})
		).rejects.toBe(boom);
	});
});

describe('notFoundToNull', () => {
	test('passes through the resolved value', async () => {
		expect(await notFoundToNull(async () => 42)).toBe(42);
	});
	test('folds a 404 into null', async () => {
		expect(
			await notFoundToNull(async () => {
				throw notFound;
			})
		).toBeNull();
	});
	test('rethrows any non-404 error', async () => {
		await expect(
			notFoundToNull(async () => {
				throw boom;
			})
		).rejects.toBe(boom);
	});
});

describe('deleteIgnoreMissing', () => {
	test('swallows a 404 (already gone)', async () => {
		await expect(
			deleteIgnoreMissing(async () => {
				throw notFound;
			})
		).resolves.toBeUndefined();
	});
	test('rethrows a non-404 error', async () => {
		await expect(
			deleteIgnoreMissing(async () => {
				throw boom;
			})
		).rejects.toBe(boom);
	});
});

describe('createIgnoreConflict', () => {
	test('swallows a 409 (peer already created it)', async () => {
		await expect(
			createIgnoreConflict(async () => {
				throw conflict;
			})
		).resolves.toBeUndefined();
	});
	test('rethrows a non-409 error', async () => {
		await expect(
			createIgnoreConflict(async () => {
				throw boom;
			})
		).rejects.toBe(boom);
	});
});

describe('retryOnConflict', () => {
	test('runs the attempt once on success', async () => {
		let calls = 0;
		await retryOnConflict('test', 3, async () => {
			calls++;
		});
		expect(calls).toBe(1);
	});

	test('warns (no throw) after N persistent conflicts', async () => {
		let calls = 0;
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (msg?: unknown) => void warnings.push(String(msg));
		try {
			await retryOnConflict('gizmo', 2, async () => {
				calls++;
				throw conflict;
			});
		} finally {
			console.warn = originalWarn;
		}
		expect(calls).toBe(2);
		expect(warnings.some(w => w.includes('gizmo') && w.includes('2'))).toBe(true);
	});

	test('rethrows a non-conflict error without retrying', async () => {
		let calls = 0;
		await expect(
			retryOnConflict('test', 3, async () => {
				calls++;
				throw boom;
			})
		).rejects.toBe(boom);
		expect(calls).toBe(1);
	});
});

describe('readXOrNull helpers', () => {
	test('return the read value when the resource exists', async () => {
		const dep = { metadata: { name: 'd' } };
		const svc = { metadata: { name: 's' } };
		const cm = { metadata: { name: 'c' } };
		const ing = { metadata: { name: 'i' } };
		const pvc = { metadata: { name: 'p' } };
		const sec = { metadata: { name: 'se' } };
		const hpa = { metadata: { name: 'h' } };
		const apps = { readNamespacedDeployment: async () => dep } as unknown as AppsV1Api;
		const core = {
			readNamespacedService: async () => svc,
			readNamespacedConfigMap: async () => cm,
			readNamespacedPersistentVolumeClaim: async () => pvc,
			readNamespacedSecret: async () => sec
		} as unknown as CoreV1Api;
		const net = { readNamespacedIngress: async () => ing } as never;
		const auto = { readNamespacedHorizontalPodAutoscaler: async () => hpa } as never;

		expect(await readDeploymentOrNull(apps, 'ns', 'd')).toBe(dep);
		expect(await readServiceOrNull(core, 'ns', 's')).toBe(svc);
		expect(await readConfigMapOrNull(core, 'ns', 'c')).toBe(cm);
		expect(await readIngressOrNull(net, 'ns', 'i')).toBe(ing);
		expect(await readPVCOrNull(core, 'ns', 'p')).toBe(pvc);
		expect(await readSecretOrNull(core, 'ns', 'se')).toBe(sec);
		expect(await readHPAOrNull(auto, 'ns', 'h')).toBe(hpa);
	});

	test('fold a 404 into null', async () => {
		const throw404 = async () => {
			throw notFound;
		};
		const apps = { readNamespacedDeployment: throw404 } as unknown as AppsV1Api;
		const core = {
			readNamespacedService: throw404,
			readNamespacedConfigMap: throw404,
			readNamespacedPersistentVolumeClaim: throw404,
			readNamespacedSecret: throw404
		} as unknown as CoreV1Api;
		const net = { readNamespacedIngress: throw404 } as never;
		const auto = { readNamespacedHorizontalPodAutoscaler: throw404 } as never;

		expect(await readDeploymentOrNull(apps, 'ns', 'd')).toBeNull();
		expect(await readServiceOrNull(core, 'ns', 's')).toBeNull();
		expect(await readConfigMapOrNull(core, 'ns', 'c')).toBeNull();
		expect(await readIngressOrNull(net, 'ns', 'i')).toBeNull();
		expect(await readPVCOrNull(core, 'ns', 'p')).toBeNull();
		expect(await readSecretOrNull(core, 'ns', 'se')).toBeNull();
		expect(await readHPAOrNull(auto, 'ns', 'h')).toBeNull();
	});
});

describe('unhealthyReason', () => {
	function coreWithPods(items: unknown[]): CoreV1Api {
		return { listNamespacedPod: async () => ({ items }) } as unknown as CoreV1Api;
	}

	test('reports a terminal waiting reason with its message', async () => {
		const core = coreWithPods([
			{ status: { containerStatuses: [{ state: { waiting: { reason: 'ImagePullBackOff', message: 'no such image' } } }] } }
		]);
		expect(await unhealthyReason(core, 'ns', 'svc-1')).toBe('ImagePullBackOff: no such image');
	});

	test('reports a non-zero terminated container', async () => {
		const core = coreWithPods([{ status: { containerStatuses: [{ state: { terminated: { reason: 'Error', exitCode: 137 } } }] } }]);
		expect(await unhealthyReason(core, 'ns', 'svc-1')).toBe('Error (exit 137)');
	});

	test('returns null when nothing is obviously wrong (benign waiting + clean exit)', async () => {
		const core = coreWithPods([
			{ status: { containerStatuses: [{ state: { waiting: { reason: 'ContainerCreating' } } }] } },
			{ status: { containerStatuses: [{ state: { terminated: { reason: 'Completed', exitCode: 0 } } }] } }
		]);
		expect(await unhealthyReason(core, 'ns', 'svc-1')).toBeNull();
	});
});

describe('rolloutFailureMessage', () => {
	test('returns the Progressing condition message when present', () => {
		const dep = { status: { conditions: [{ type: 'Progressing', message: 'deadline exceeded' }] } } as never;
		expect(rolloutFailureMessage(dep)).toBe('deadline exceeded');
	});
	test('falls back to "rollout failed" when no Progressing message', () => {
		expect(rolloutFailureMessage({ status: { conditions: [] } } as never)).toBe('rollout failed');
		expect(rolloutFailureMessage({} as never)).toBe('rollout failed');
	});
});
