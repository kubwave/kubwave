import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AppsV1Api, AutoscalingV2Api, BatchV1Api, CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import type { DeployContext } from '~/modules/worker/jobs/deployments/deployers/types';

// Replace the env module so the public-repo deployer sees a configured registry + builder images regardless of load order.
mock.module('~/shared/config/worker-env', () => ({
	env: {
		podNamespace: 'kubwave',
		registryEndpoint: 'test-registry:5000',
		registryInsecure: true,
		builderImage: 'moby/buildkit:v0.31.0-rootless',
		buildToolsImage: 'ghcr.io/acme/build-tools:0.2.0',
		buildImagePullSecrets: ['regcred'],
		builderServiceAccount: 'kubwave-builder',
		buildJobTtlSeconds: 3600,
		buildTimeoutSeconds: 1800,
		buildMemoryRequest: '1Gi',
		buildMemoryLimit: '2Gi',
		registryPushSecretName: undefined,
		registryPullSecretName: undefined,
		storageClassName: ''
	}
}));
mock.module('@kubwave/db', () => ({
	deployments: { id: 'id', imageRef: 'imageRef' },
	db: {
		update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 'dep-1' }] }) }) })
	}
}));
const { publicRepoDeployer } = await import('~/modules/worker/jobs/deployments/deployers/public-repo/deployer');

const notFound = () => Promise.reject({ code: 404 });

interface Calls {
	createdJob: boolean;
	createdConfigMap: boolean;
}

function makeCtx(opts: { job: unknown | 'missing'; podLog?: string; calls: Calls; createJobRejects?: unknown }): DeployContext {
	const batch = {
		readNamespacedJob: () => (opts.job === 'missing' ? notFound() : Promise.resolve(opts.job)),
		createNamespacedJob: () => {
			opts.calls.createdJob = true;
			// Simulate a racing tick / restart handoff that already created the Job (409 AlreadyExists).
			return opts.createJobRejects ? Promise.reject(opts.createJobRejects) : Promise.resolve({});
		}
	};
	const core = {
		// A public-repo build never creates a ConfigMap — flip a flag if it ever tries.
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
			type: 'public-repo',
			phase: 'building',
			config: { repoUrl: 'https://github.com/user/repo', branch: 'main', containerPort: 3000, env: [], domains: [], volumes: [] }
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

describe('publicRepoDeployer build state machine', () => {
	test('no build Job and no image yet → creates the Job (no ConfigMap) and reports building', async () => {
		stubImageExists(false);
		const calls: Calls = { createdJob: false, createdConfigMap: false };
		const result = await publicRepoDeployer.reconcile(makeCtx({ job: 'missing', calls }));
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'building' });
		expect(calls.createdJob).toBe(true);
		// Source comes from git, not a pasted string — no ConfigMap is ever created.
		expect(calls.createdConfigMap).toBe(false);
		expect((result.events ?? []).some(e => e.step === 'build-started')).toBe(true);
	});

	test('Job create races a concurrent tick (409 AlreadyExists) → swallowed, still reports building', async () => {
		// The Job name is deterministic, so a create race just means "build already exists" — swallow the 409 and report in-flight.
		stubImageExists(false);
		const calls: Calls = { createdJob: false, createdConfigMap: false };
		const result = await publicRepoDeployer.reconcile(makeCtx({ job: 'missing', calls, createJobRejects: { code: 409 } }));
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'building' });
		expect(calls.createdJob).toBe(true);
		expect((result.events ?? []).some(e => e.step === 'build-started')).toBe(true);
	});

	test('a non-conflict Job create error propagates (not silently swallowed)', async () => {
		stubImageExists(false);
		const calls: Calls = { createdJob: false, createdConfigMap: false };
		expect(publicRepoDeployer.reconcile(makeCtx({ job: 'missing', calls, createJobRejects: { code: 500 } }))).rejects.toBeDefined();
	});

	test('build Job still running → reports building, creates nothing', async () => {
		stubImageExists(false);
		const calls: Calls = { createdJob: false, createdConfigMap: false };
		const result = await publicRepoDeployer.reconcile(makeCtx({ job: { status: { active: 1 } }, calls }));
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'building' });
		expect(calls.createdJob).toBe(false);
	});

	test('build Job failed → terminal failure carrying the build log tail', async () => {
		stubImageExists(false);
		const calls: Calls = { createdJob: false, createdConfigMap: false };
		const result = await publicRepoDeployer.reconcile(
			makeCtx({ job: { status: { failed: 1 } }, podLog: 'error: undefined is not a function', calls })
		);
		expect(result.state).toBe('failed');
		if (result.state === 'failed') expect(result.error).toContain('undefined is not a function');
		expect(calls.createdJob).toBe(false);
	});
});

describe('publicRepoDeployer teardown', () => {
	// teardown reaps any in-flight build Job; unlike dockerfile/private-repo there's NO ConfigMap/Secret to reclaim (source = git).
	interface TeardownCalls {
		deletedJobs: string[];
		deletedConfigMaps: string[];
		deletedSecrets: string[];
		misc: string[];
	}

	function makeTeardownKc(opts: { jobs: string[]; calls: TeardownCalls }) {
		const batch = {
			listNamespacedJob: () => Promise.resolve({ items: opts.jobs.map(name => ({ metadata: { name } })) }),
			deleteNamespacedJob: (req: { name: string }) => {
				opts.calls.deletedJobs.push(req.name);
				return Promise.resolve({});
			}
		};
		const core = {
			// Flip flags if teardown ever tries to reclaim a ConfigMap/Secret — it must not for public-repo.
			deleteNamespacedConfigMap: (req: { name: string }) => (opts.calls.deletedConfigMaps.push(req.name), Promise.resolve({})),
			listNamespacedConfigMap: () => (opts.calls.deletedConfigMaps.push('LISTED'), Promise.resolve({ items: [] })),
			listNamespacedSecret: () => (opts.calls.deletedSecrets.push('LISTED'), Promise.resolve({ items: [] })),
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
		} as unknown as KubeConfig;
	}

	const emptyTeardownCalls = (): TeardownCalls => ({ deletedJobs: [], deletedConfigMaps: [], deletedSecrets: [], misc: [] });

	test('reaps the labelled build Job(s) for the service and runs the runtime teardown', async () => {
		const calls = emptyTeardownCalls();
		const kc = makeTeardownKc({ jobs: ['public-repo-build-dep-1'], calls });
		await publicRepoDeployer.teardown({ kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' });
		expect(calls.deletedJobs).toEqual(['public-repo-build-dep-1']);
		expect(calls.misc).toContain('deployment');
		expect(calls.misc).toContain('service');
		// No ConfigMap/Secret reaping path — the source is git, nothing pasted to reclaim.
		expect(calls.deletedConfigMaps).toEqual([]);
	});

	test('no-op build reap when the service has no in-flight build Job', async () => {
		const calls = emptyTeardownCalls();
		const kc = makeTeardownKc({ jobs: [], calls });
		await publicRepoDeployer.teardown({ kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' });
		expect(calls.deletedJobs).toEqual([]);
	});
});
