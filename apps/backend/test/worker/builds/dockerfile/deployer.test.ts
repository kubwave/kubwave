import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AppsV1Api, AutoscalingV2Api, BatchV1Api, CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import type { DeployContext } from '~/modules/worker/jobs/deployments/deployers/types';

// Replace the env module so the Dockerfile deployer sees a configured registry regardless of test-run load order.
mock.module('~/shared/config/worker-env', () => ({
	env: {
		podNamespace: 'kubwave',
		registryEndpoint: 'test-registry:5000',
		registryInsecure: true,
		builderImage: 'moby/buildkit:v0.31.0-rootless',
		builderServiceAccount: 'kubwave-builder',
		buildJobTtlSeconds: 3600,
		buildTimeoutSeconds: 1800,
		buildMemoryRequest: '1Gi',
		buildMemoryLimit: '2Gi',
		registryPushSecretName: undefined,
		registryPullSecretName: undefined,
		registryPullDockerConfigJson: undefined,
		storageClassName: ''
	}
}));
mock.module('@kubwave/db', () => ({
	deployments: { id: 'id', imageRef: 'imageRef' },
	db: {
		update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 'dep-1' }] }) }) })
	}
}));
const { dockerfileDeployer, deleteBuildResources } = await import('~/modules/worker/jobs/deployments/deployers/dockerfile/deployer');

const notFound = () => Promise.reject({ code: 404 });

interface Calls {
	createdJob: boolean;
	createdConfigMap: boolean;
}

function makeCtx(opts: { job: unknown | 'missing'; podLog?: string; calls: Calls }): DeployContext {
	const batch = {
		readNamespacedJob: () => (opts.job === 'missing' ? notFound() : Promise.resolve(opts.job)),
		createNamespacedJob: () => {
			opts.calls.createdJob = true;
			return Promise.resolve({});
		}
	};
	const core = {
		readNamespacedConfigMap: () => notFound(),
		createNamespacedConfigMap: () => {
			opts.calls.createdConfigMap = true;
			return Promise.resolve({});
		},
		listNamespacedPod: () => Promise.resolve({ items: [{ metadata: { name: 'build-pod' } }] }),
		readNamespacedPodLog: () => Promise.resolve(opts.podLog ?? '')
	};
	const kc = {
		makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batch : klass === CoreV1Api ? core : {})
	} as unknown as KubeConfig;

	return {
		kc,
		namespace: 'kubwave-env-1',
		environmentId: 'env-1',
		deployment: {
			id: 'dep-1',
			serviceId: 'svc-1',
			type: 'dockerfile',
			phase: 'building',
			config: { dockerfile: 'FROM nginx:1.27', containerPort: 80, env: [], domains: [], volumes: [] }
		} as unknown as DeployContext['deployment'],
		ingress: { className: undefined, clusterIssuer: undefined, annotations: {} },
		defaultDomainHost: null
	};
}

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

// imageExists probes the registry over HTTP; stub it so the no-image path is deterministic.
function stubImageExists(exists: boolean) {
	globalThis.fetch = (async () => ({ status: exists ? 200 : 404 })) as unknown as typeof fetch;
}

describe('dockerfileDeployer build state machine', () => {
	test('no build Job and no image yet → creates the ConfigMap + Job and reports building', async () => {
		stubImageExists(false);
		const calls: Calls = { createdJob: false, createdConfigMap: false };
		const result = await dockerfileDeployer.reconcile(makeCtx({ job: 'missing', calls }));
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'building' });
		expect(calls.createdConfigMap).toBe(true);
		expect(calls.createdJob).toBe(true);
		expect((result.events ?? []).some(e => e.step === 'build-started')).toBe(true);
	});

	test('build Job still running → reports building, creates nothing', async () => {
		stubImageExists(false);
		const calls: Calls = { createdJob: false, createdConfigMap: false };
		const result = await dockerfileDeployer.reconcile(makeCtx({ job: { status: { active: 1 } }, calls }));
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'building' });
		expect(calls.createdJob).toBe(false);
	});

	test('build Job failed → terminal failure carrying the build log tail', async () => {
		stubImageExists(false);
		const calls: Calls = { createdJob: false, createdConfigMap: false };
		const result = await dockerfileDeployer.reconcile(
			makeCtx({ job: { status: { failed: 1 } }, podLog: 'Error: failed to fetch base image', calls })
		);
		expect(result.state).toBe('failed');
		if (result.state === 'failed') expect(result.error).toContain('failed to fetch base image');
		expect(calls.createdJob).toBe(false);
	});
});

interface TeardownCalls {
	deletedJobs: string[];
	deletedConfigMaps: string[];
	// every other teardownRuntime delete, recorded only to prove the chain ran without throwing.
	misc: string[];
}

// Fake kc whose clients resolve every call; list methods return the supplied items, deletes just record.
function makeTeardownKc(opts: { jobs: string[]; configMaps: string[]; calls: TeardownCalls }) {
	const batch = {
		listNamespacedJob: () => Promise.resolve({ items: opts.jobs.map(name => ({ metadata: { name } })) }),
		deleteNamespacedJob: (req: { name: string }) => {
			opts.calls.deletedJobs.push(req.name);
			return Promise.resolve({});
		}
	};
	const core = {
		listNamespacedConfigMap: () => Promise.resolve({ items: opts.configMaps.map(name => ({ metadata: { name } })) }),
		deleteNamespacedConfigMap: (req: { name: string }) => {
			opts.calls.deletedConfigMaps.push(req.name);
			return Promise.resolve({});
		},
		// teardownRuntime + teardownNetworking touch these; record-and-resolve is enough.
		deleteNamespacedSecret: () => (opts.calls.misc.push('secret'), Promise.resolve({})),
		deleteNamespacedService: () => (opts.calls.misc.push('service'), Promise.resolve({})),
		listNamespacedPersistentVolumeClaim: () => Promise.resolve({ items: [] })
	};
	const apps = { deleteNamespacedDeployment: () => (opts.calls.misc.push('deployment'), Promise.resolve({})) };
	const autoscaling = { deleteNamespacedHorizontalPodAutoscaler: () => (opts.calls.misc.push('hpa'), Promise.resolve({})) };
	const net = { deleteNamespacedIngress: () => (opts.calls.misc.push('ingress'), Promise.resolve({})) };
	return {
		makeApiClient: (klass: unknown) =>
			klass === BatchV1Api
				? batch
				: klass === CoreV1Api
					? core
					: klass === AppsV1Api
						? apps
						: klass === AutoscalingV2Api
							? autoscaling
							: klass === NetworkingV1Api
								? net
								: {}
	} as unknown as DeployContext['kc'];
}

const emptyTeardownCalls = (): TeardownCalls => ({ deletedJobs: [], deletedConfigMaps: [], misc: [] });

describe('deleteBuildResources', () => {
	test('deletes the deployment-scoped build Job and its Dockerfile ConfigMap by deterministic name', async () => {
		const calls = emptyTeardownCalls();
		const kc = makeTeardownKc({ jobs: [], configMaps: [], calls });
		await deleteBuildResources(kc, 'kubwave', 'dep-1');
		expect(calls.deletedJobs).toEqual(['dockerfile-build-dep-1']);
		expect(calls.deletedConfigMaps).toEqual(['dockerfile-build-dep-1']);
	});

	test('tolerates already-gone objects (404) without throwing', async () => {
		const kc = {
			makeApiClient: (klass: unknown) =>
				klass === BatchV1Api
					? { deleteNamespacedJob: () => Promise.reject({ code: 404 }) }
					: { deleteNamespacedConfigMap: () => Promise.reject({ code: 404 }) }
		} as unknown as DeployContext['kc'];
		await expect(deleteBuildResources(kc, 'kubwave', 'dep-1')).resolves.toBeUndefined();
	});
});

describe('dockerfileDeployer teardown', () => {
	// teardown runs the runtime teardown then reaps every labelled build Job + Dockerfile ConfigMap (the bit public-repo lacks).
	test('reaps every labelled build Job and Dockerfile ConfigMap for the service', async () => {
		const calls = emptyTeardownCalls();
		const kc = makeTeardownKc({ jobs: ['dockerfile-build-dep-1'], configMaps: ['dockerfile-build-dep-1'], calls });
		await dockerfileDeployer.teardown({ kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' });
		expect(calls.deletedJobs).toEqual(['dockerfile-build-dep-1']);
		expect(calls.deletedConfigMaps).toEqual(['dockerfile-build-dep-1']);
		// the runtime-teardown chain ran too (deployment + service deletes recorded).
		expect(calls.misc).toContain('deployment');
		expect(calls.misc).toContain('service');
	});

	test('no-op build reap when the service has no in-flight build artifacts', async () => {
		const calls = emptyTeardownCalls();
		const kc = makeTeardownKc({ jobs: [], configMaps: [], calls });
		await dockerfileDeployer.teardown({ kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' });
		expect(calls.deletedJobs).toEqual([]);
		expect(calls.deletedConfigMaps).toEqual([]);
	});
});
