import { afterEach, describe, expect, mock, test } from 'bun:test';
import { BatchV1Api, CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import type { CoreV1Api as CoreV1ApiType, V1Job } from '@kubernetes/client-node';
import type { DeployContext } from '~/modules/worker/jobs/deployments/deployers/types';

// The shared build→deploy state machine; stub env, db, and the runtime deploy core (Phase B). shared.test.ts covers the pure helpers.
mock.module('~/shared/config/worker-env', () => ({
	env: {
		podNamespace: 'kubwave',
		registryEndpoint: 'test-registry:5000',
		registryInsecure: true
	}
}));
const persistedImageRefs: string[] = [];
mock.module('@kubwave/db', () => ({
	deployments: { id: 'id', imageRef: 'imageRef' },
	deploymentLogs: {},
	db: {
		update: () => ({
			set: (values: { imageRef?: string }) => {
				if (values.imageRef) persistedImageRefs.push(values.imageRef);
				return { where: () => ({ returning: async () => [{ id: 'dep-1' }] }) };
			}
		})
	}
}));

// Phase B hand-off: record the call + return a recognizable result to prove the machine reaches the deploy core.
const reconcileCalls: Array<{ imageRef: string }> = [];
mock.module('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service', () => ({
	reconcileRuntime: async (_ctx: DeployContext, _config: unknown, imageRef: string) => {
		reconcileCalls.push({ imageRef });
		return { state: 'progressing', phase: 'rolling-out', events: [{ ts: 'x', level: 'info', step: 'deploy', message: 'applied' }] };
	},
	teardownRuntime: async () => {}
}));

const { reapBuildJobs, deleteBuildArtifactsForDeployment, buildFailureReason, imageExists, runBuildReconcile } =
	await import('~/modules/worker/jobs/deployments/builds/service');

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	reconcileCalls.length = 0;
	persistedImageRefs.length = 0;
});

// reapBuildJobs — lists every builder Job for a service and deletes each, tolerating 404s.
describe('reapBuildJobs', () => {
	test('deletes every labelled build Job for the service', async () => {
		const deleted: string[] = [];
		const batch = {
			listNamespacedJob: () => Promise.resolve({ items: [{ metadata: { name: 'job-a' } }, { metadata: { name: 'job-b' } }] }),
			deleteNamespacedJob: (req: { name: string }) => {
				deleted.push(req.name);
				return Promise.resolve({});
			}
		} as unknown as BatchV1Api;
		await reapBuildJobs(batch, 'svc-1');
		expect(deleted).toEqual(['job-a', 'job-b']);
	});

	test('no-op when the service has no build Jobs', async () => {
		let deleteCount = 0;
		const batch = {
			listNamespacedJob: () => Promise.resolve({ items: [] }),
			deleteNamespacedJob: () => {
				deleteCount++;
				return Promise.resolve({});
			}
		} as unknown as BatchV1Api;
		await reapBuildJobs(batch, 'svc-1');
		expect(deleteCount).toBe(0);
	});

	test('tolerates a 404 on the list (namespace gone) without throwing', async () => {
		const batch = { listNamespacedJob: () => Promise.reject({ code: 404 }) } as unknown as BatchV1Api;
		await expect(reapBuildJobs(batch, 'svc-1')).resolves.toBeUndefined();
	});
});

describe('deleteBuildArtifactsForDeployment', () => {
	test('deletes labelled Jobs, ConfigMaps, Secrets, and NetworkPolicies for the deployment', async () => {
		const deleted = { jobs: [] as string[], configMaps: [] as string[], secrets: [] as string[], policies: [] as string[] };
		const batch = {
			listNamespacedJob: () => Promise.resolve({ items: [{ metadata: { name: 'job-1' } }] }),
			deleteNamespacedJob: (req: { name: string }) => {
				deleted.jobs.push(req.name);
				return Promise.resolve({});
			}
		};
		const core = {
			listNamespacedConfigMap: () => Promise.resolve({ items: [{ metadata: { name: 'cm-1' } }] }),
			listNamespacedSecret: () => Promise.resolve({ items: [{ metadata: { name: 'sec-1' } }] }),
			deleteNamespacedConfigMap: (req: { name: string }) => {
				deleted.configMaps.push(req.name);
				return Promise.resolve({});
			},
			deleteNamespacedSecret: (req: { name: string }) => {
				deleted.secrets.push(req.name);
				return Promise.resolve({});
			}
		};
		const net = {
			listNamespacedNetworkPolicy: () => Promise.resolve({ items: [{ metadata: { name: 'np-1' } }] }),
			deleteNamespacedNetworkPolicy: (req: { name: string }) => {
				deleted.policies.push(req.name);
				return Promise.resolve({});
			}
		};
		const kc = {
			makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batch : klass === CoreV1Api ? core : klass === NetworkingV1Api ? net : {})
		} as unknown as KubeConfig;

		await deleteBuildArtifactsForDeployment(kc, 'dep-1');
		expect(deleted).toEqual({ jobs: ['job-1'], configMaps: ['cm-1'], secrets: ['sec-1'], policies: ['np-1'] });
	});
});

// buildFailureReason — best-effort failure detail off the failed build pod.
describe('buildFailureReason', () => {
	function coreWith(opts: { pod?: unknown; log?: string | (() => never) }): CoreV1ApiType {
		return {
			listNamespacedPod: () => Promise.resolve({ items: opts.pod ? [opts.pod] : [] }),
			readNamespacedPodLog: () => (typeof opts.log === 'function' ? Promise.reject(new Error('no log')) : Promise.resolve(opts.log ?? ''))
		} as unknown as CoreV1ApiType;
	}

	test('returns a bare "Build failed" when no build pod exists', async () => {
		const reason = await buildFailureReason(coreWith({}), 'kubwave', 'job-1', ['builder']);
		expect(reason).toBe('Build failed');
	});

	test('summarizes the failed container log tail', async () => {
		const pod = {
			metadata: { name: 'build-pod' },
			status: { containerStatuses: [{ name: 'builder', state: { terminated: { exitCode: 1 } } }] }
		};
		const reason = await buildFailureReason(coreWith({ pod, log: 'Error: no such base image' }), 'kubwave', 'job-1', ['builder']);
		expect(reason).toBe('Build failed:\nError: no such base image');
	});

	test('falls back to the terminated message when the log read throws', async () => {
		const pod = {
			metadata: { name: 'build-pod' },
			status: { containerStatuses: [{ name: 'builder', state: { terminated: { exitCode: 137, message: 'OOMKilled' } } }] }
		};
		const reason = await buildFailureReason(coreWith({ pod, log: () => undefined as never }), 'kubwave', 'job-1', ['builder']);
		expect(reason).toBe('Build failed: OOMKilled');
	});

	test('falls back to the terminated reason + exit code when there is no message', async () => {
		const pod = {
			metadata: { name: 'build-pod' },
			// no failed container recorded (deadline kill) → falls back to the target container's terminated state
			status: { containerStatuses: [{ name: 'builder', state: { terminated: { reason: 'DeadlineExceeded', exitCode: 2 } } }] }
		};
		// empty log → summary empty → falls through to terminated reason
		const reason = await buildFailureReason(coreWith({ pod, log: '' }), 'kubwave', 'job-1', ['builder']);
		expect(reason).toBe('Build failed: DeadlineExceeded (exit 2)');
	});
});

// imageExists — registry manifest HEAD probe; any error resolves to false.
describe('imageExists', () => {
	test('true on a 200 manifest HEAD', async () => {
		globalThis.fetch = (async () => ({ status: 200 })) as unknown as typeof fetch;
		expect(await imageExists('reg:5000/env-e1/svc-abc:dep-1')).toBe(true);
	});

	test('false on a non-200', async () => {
		globalThis.fetch = (async () => ({ status: 404 })) as unknown as typeof fetch;
		expect(await imageExists('reg:5000/env-e1/svc-abc:dep-1')).toBe(false);
	});

	test('false (not a throw) when the registry fetch errors', async () => {
		globalThis.fetch = (async () => {
			throw new Error('connection refused');
		}) as unknown as typeof fetch;
		expect(await imageExists('reg:5000/env-e1/svc-abc:dep-1')).toBe(false);
	});

	test('false for an unparseable ref (no host or no tag)', async () => {
		expect(await imageExists('noslash')).toBe(false);
		expect(await imageExists('host/repo-without-tag')).toBe(false);
	});
});

// runBuildReconcile — the deploy hand-off branches not covered by the per-deployer build tests.
describe('runBuildReconcile deploy hand-off', () => {
	function makeCtx(opts: { job: V1Job | null; phase?: string; imageRef?: string | null; buildMode?: DeployContext['buildMode'] }): DeployContext {
		const batch = {
			readNamespacedJob: () => (opts.job ? Promise.resolve(opts.job) : Promise.reject({ code: 404 }))
		};
		const core = {
			listNamespacedPod: () => Promise.resolve({ items: [{ metadata: { name: 'build-pod' } }] }),
			readNamespacedPodLog: () => Promise.resolve('')
		};
		const kc = {
			makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batch : klass === CoreV1Api ? core : {})
		} as unknown as KubeConfig;
		return {
			kc,
			namespace: 'kubwave',
			environmentId: 'env-1',
			deployment: {
				id: 'dep-1',
				serviceId: 'svc-1',
				type: 'dockerfile',
				phase: opts.phase ?? 'building',
				imageRef: opts.imageRef ?? null,
				config: { containerPort: 80, env: [], domains: [], volumes: [] }
			} as unknown as DeployContext['deployment'],
			ingress: { className: undefined, clusterIssuer: undefined, annotations: {} },
			defaultDomainHost: null,
			buildMode: opts.buildMode
		};
	}

	const opts = (startBuild: () => Promise<void> = async () => {}) => ({
		jobName: 'dockerfile-build-dep-1',
		buildContainers: ['builder'],
		startMessage: 'Building',
		notConfiguredError: 'no registry',
		startBuild
	});

	test('build Job succeeded while phase=building → emits build-succeeded + image-ready, then deploys', async () => {
		const succeeded = { status: { succeeded: 1 } } as V1Job;
		const result = await runBuildReconcile(makeCtx({ job: succeeded, phase: 'building' }), {} as never, opts());
		// merged: the two build-transition events first, then the runtime core's event
		const steps = (result.events ?? []).map(e => e.step);
		expect(steps).toEqual(['build-succeeded', 'image-ready', 'deploy']);
		expect(reconcileCalls).toHaveLength(1);
		expect(reconcileCalls[0]!.imageRef).toBe('test-registry:5000/env-env-1/svc-svc-1:dep-1');
		expect(persistedImageRefs).toEqual(['test-registry:5000/env-env-1/svc-svc-1:dep-1']);
		expect(result).toMatchObject({ state: 'progressing', phase: 'rolling-out' });
	});

	test('build Job succeeded but phase already past building → no duplicate transition events, still deploys', async () => {
		const succeeded = { status: { succeeded: 1 } } as V1Job;
		const result = await runBuildReconcile(makeCtx({ job: succeeded, phase: 'rolling-out' }), {} as never, opts());
		const steps = (result.events ?? []).map(e => e.step);
		// only the runtime core's event — the build→deploy transition fired on an earlier tick
		expect(steps).toEqual(['deploy']);
		expect(reconcileCalls).toHaveLength(1);
	});

	test('a stored image_ref wins over the current registry-derived ref', async () => {
		const succeeded = { status: { succeeded: 1 } } as V1Job;
		await runBuildReconcile(makeCtx({ job: succeeded, imageRef: 'old-registry/env-env-1/svc-svc-1:dep-1' }), {} as never, opts());
		expect(persistedImageRefs).toEqual([]);
		expect(reconcileCalls).toEqual([{ imageRef: 'old-registry/env-env-1/svc-svc-1:dep-1' }]);
	});

	test('rollback mode uses the stored image_ref directly and never starts a build', async () => {
		globalThis.fetch = (async () => ({ status: 404 })) as unknown as typeof fetch;
		let started = false;
		const result = await runBuildReconcile(
			makeCtx({ job: null, imageRef: 'old-registry/env-env-1/svc-svc-1:dep-1', buildMode: 'rollback' }),
			{} as never,
			opts(async () => void (started = true))
		);
		expect(started).toBe(false);
		expect(persistedImageRefs).toEqual([]);
		expect(reconcileCalls).toEqual([{ imageRef: 'old-registry/env-env-1/svc-svc-1:dep-1' }]);
		expect(result).toMatchObject({ state: 'progressing', phase: 'rolling-out' });
	});

	test('rollback mode without a stored image_ref can use an existing legacy deterministic image but still never starts a build', async () => {
		globalThis.fetch = (async () => ({ status: 200 })) as unknown as typeof fetch;
		let started = false;
		const result = await runBuildReconcile(
			makeCtx({ job: null, imageRef: null, buildMode: 'rollback' }),
			{} as never,
			opts(async () => void (started = true))
		);
		expect(started).toBe(false);
		expect(persistedImageRefs).toEqual(['test-registry:5000/env-env-1/svc-svc-1:dep-1']);
		expect(reconcileCalls).toEqual([{ imageRef: 'test-registry:5000/env-env-1/svc-svc-1:dep-1' }]);
		expect(result).toMatchObject({ state: 'progressing', phase: 'rolling-out' });
	});

	test('rollback mode without a stored image_ref and no legacy image fails instead of starting a build', async () => {
		globalThis.fetch = (async () => ({ status: 404 })) as unknown as typeof fetch;
		let started = false;
		const result = await runBuildReconcile(
			makeCtx({ job: null, imageRef: null, buildMode: 'rollback' }),
			{} as never,
			opts(async () => void (started = true))
		);
		expect(started).toBe(false);
		expect(reconcileCalls).toEqual([]);
		expect(result).toMatchObject({ state: 'failed' });
		if (result.state === 'failed') expect(result.error).toContain('no recorded image reference');
	});

	test('no Job but the image already exists (re-deploy / rollback) → skips the build, goes straight to deploy', async () => {
		globalThis.fetch = (async () => ({ status: 200 })) as unknown as typeof fetch;
		let started = false;
		const result = await runBuildReconcile(
			makeCtx({ job: null }),
			{} as never,
			opts(async () => void (started = true))
		);
		expect(started).toBe(false); // build skipped
		expect(reconcileCalls).toHaveLength(1);
		expect(result).toMatchObject({ state: 'progressing', phase: 'rolling-out' });
	});

	test('no Job and no image → runs startBuild and reports building (does not deploy)', async () => {
		globalThis.fetch = (async () => ({ status: 404 })) as unknown as typeof fetch;
		let started = false;
		const result = await runBuildReconcile(
			makeCtx({ job: null }),
			{} as never,
			opts(async () => void (started = true))
		);
		expect(started).toBe(true);
		expect(reconcileCalls).toHaveLength(0); // never reached Phase B
		expect(result).toMatchObject({ state: 'progressing', phase: 'building' });
		expect((result.events ?? []).some(e => e.step === 'build-started')).toBe(true);
	});
});
