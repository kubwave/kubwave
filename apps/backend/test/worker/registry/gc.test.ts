import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { KubeConfig, V1Pod, V1Status } from '@kubernetes/client-node';

// Mutable env so tests can flip registryGcEnabled / registryEndpoint to reach the disabled early-out.
const fakeEnv = {
	podNamespace: 'kubwave',
	registryEndpoint: 'kubwave-registry.kubwave.svc.cluster.local:5000',
	registryGcEnabled: true,
	registryGcIntervalMs: 86_400_000
};
mock.module('~/shared/config/worker-env', () => ({ env: fakeEnv }));

let buildRows: Array<{ id: string }> = [];
let capturedWhere: unknown;
mock.module('@kubwave/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: async (arg: unknown) => {
					capturedWhere = arg;
					return buildRows;
				}
			})
		})
	},
	deployments: { id: 'deployments.id', type: 'deployments.type', status: 'deployments.status' }
}));
mock.module('@kubwave/kube', () => ({ getKubeConfig: () => ({}) }));

// drizzle helpers reduced to identity captures so the where() shape is assertion-friendly.
mock.module('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
	inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] })
}));

// Default execInPod does live websocket IO (no seam) so tests inject the exec seam; don't mock @kubernetes/client-node (star-re-export breaks under a spread-mock).

const { buildGcCommand, selectRegistryPod, parseExecSuccess, garbageCollectRegistry } = await import('~/modules/worker/jobs/registry/gc');

afterEach(() => {
	fakeEnv.registryGcEnabled = true;
	fakeEnv.registryEndpoint = 'kubwave-registry.kubwave.svc.cluster.local:5000';
	buildRows = [];
});

// makeApiClient is only used to reach CoreV1Api, which our injected findRegistryPod ignores.
const fakeKc = { makeApiClient: () => ({}) } as unknown as KubeConfig;

describe('buildGcCommand', () => {
	test('runs delete-untagged garbage-collect against the stock config path', () => {
		expect(buildGcCommand()).toEqual(['registry', 'garbage-collect', '-m', '/etc/docker/registry/config.yml']);
	});
});

describe('selectRegistryPod', () => {
	test('returns the name of a Running registry pod', () => {
		const pods = [
			{ metadata: { name: 'kubwave-registry-old' }, status: { phase: 'Terminating' } },
			{ metadata: { name: 'kubwave-registry-new' }, status: { phase: 'Running' } }
		] as V1Pod[];
		expect(selectRegistryPod(pods)).toBe('kubwave-registry-new');
	});

	test('returns null when no pod is Running', () => {
		expect(selectRegistryPod([{ metadata: { name: 'x' }, status: { phase: 'Pending' } }] as V1Pod[])).toBeNull();
		expect(selectRegistryPod([])).toBeNull();
	});
});

describe('parseExecSuccess', () => {
	test('only a Success status counts as success', () => {
		expect(parseExecSuccess({ status: 'Success' } as V1Status)).toBe(true);
		expect(parseExecSuccess({ status: 'Failure' } as V1Status)).toBe(false);
		expect(parseExecSuccess(undefined)).toBe(false);
	});
});

describe('garbageCollectRegistry — gate + outcome (injected seams)', () => {
	test('no-op when there is no registry pod (dev / registry disabled)', async () => {
		let execed = false;
		const outcome = await garbageCollectRegistry({
			kc: fakeKc,
			findRegistryPod: async () => null,
			countBuildsInFlight: async () => 0,
			exec: async () => {
				execed = true;
				return { success: true, output: '' };
			}
		});
		expect(outcome).toBe('no-pod');
		expect(execed).toBe(false);
	});

	test('gated (no exec) while a build is in flight', async () => {
		let execed = false;
		const outcome = await garbageCollectRegistry({
			kc: fakeKc,
			findRegistryPod: async () => 'kubwave-registry-abc',
			countBuildsInFlight: async () => 1,
			exec: async () => {
				execed = true;
				return { success: true, output: '' };
			}
		});
		expect(outcome).toBe('gated');
		expect(execed).toBe(false);
	});

	test('execs garbage-collect in the registry pod when the gate is clear', async () => {
		const calls: Array<{ pod: string; container: string; command: string[] }> = [];
		const outcome = await garbageCollectRegistry({
			kc: fakeKc,
			findRegistryPod: async () => 'kubwave-registry-abc',
			countBuildsInFlight: async () => 0,
			exec: async (_kc, _ns, pod, container, command) => {
				calls.push({ pod, container, command });
				return { success: true, output: 'done' };
			}
		});
		expect(outcome).toBe('ok');
		expect(calls).toEqual([
			{ pod: 'kubwave-registry-abc', container: 'registry', command: ['registry', 'garbage-collect', '-m', '/etc/docker/registry/config.yml'] }
		]);
	});

	test('reports failure when the exec exits non-zero', async () => {
		const outcome = await garbageCollectRegistry({
			kc: fakeKc,
			findRegistryPod: async () => 'kubwave-registry-abc',
			countBuildsInFlight: async () => 0,
			exec: async () => ({ success: false, output: 'permission denied' })
		});
		expect(outcome).toBe('failed');
	});
});

describe('garbageCollectRegistry — disabled early-out', () => {
	test('disabled when REGISTRY_GC_ENABLED is off', async () => {
		fakeEnv.registryGcEnabled = false;
		expect(await garbageCollectRegistry({ kc: fakeKc })).toBe('disabled');
	});

	test('disabled when no registry endpoint is configured (dev)', async () => {
		fakeEnv.registryEndpoint = '';
		expect(await garbageCollectRegistry({ kc: fakeKc })).toBe('disabled');
	});
});

describe('garbageCollectRegistry — default findRegistryPod', () => {
	test('lists pods by the registry selector through CoreV1Api and selects the Running one', async () => {
		let listArgs: { namespace?: string; labelSelector?: string } = {};
		const coreApi = {
			listNamespacedPod: async (args: { namespace: string; labelSelector: string }) => {
				listArgs = args;
				return { items: [{ metadata: { name: 'kubwave-registry-1' }, status: { phase: 'Running' } }] as V1Pod[] };
			}
		};
		const kc = { makeApiClient: () => coreApi } as unknown as KubeConfig;

		const calls: string[] = [];
		const outcome = await garbageCollectRegistry({
			kc,
			countBuildsInFlight: async () => 0,
			exec: async (_kc, _ns, pod) => {
				calls.push(pod);
				return { success: true, output: '' };
			}
		});

		expect(outcome).toBe('ok');
		expect(calls).toEqual(['kubwave-registry-1']);
		expect(listArgs).toEqual({ namespace: 'kubwave', labelSelector: 'app.kubernetes.io/name=registry' });
	});

	test('no-pod when the live listing turns up no Running registry pod', async () => {
		const coreApi = { listNamespacedPod: async () => ({ items: [] as V1Pod[] }) };
		const kc = { makeApiClient: () => coreApi } as unknown as KubeConfig;
		expect(await garbageCollectRegistry({ kc, countBuildsInFlight: async () => 0 })).toBe('no-pod');
	});
});

describe('garbageCollectRegistry — default buildsInFlight (db query)', () => {
	test('gates on the count of in-flight Dockerfile builds returned by the db', async () => {
		buildRows = [{ id: 'dep-1' }, { id: 'dep-2' }];
		const outcome = await garbageCollectRegistry({
			kc: fakeKc,
			findRegistryPod: async () => 'kubwave-registry-1',
			exec: async () => ({ success: true, output: '' })
		});
		expect(outcome).toBe('gated');
		// where() filters type=dockerfile AND status IN BUILD_ACTIVE_STATUSES (captured via the stubbed and()).
		expect(capturedWhere).toMatchObject({ and: expect.any(Array) });
	});

	test('proceeds to exec when the db reports zero in-flight builds', async () => {
		buildRows = [];
		const outcome = await garbageCollectRegistry({
			kc: fakeKc,
			findRegistryPod: async () => 'kubwave-registry-1',
			exec: async () => ({ success: true, output: '' })
		});
		expect(outcome).toBe('ok');
	});
});
