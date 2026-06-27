import { afterEach, describe, expect, mock, test } from 'bun:test';
import { BatchV1Api, CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import type { DeployContext, TeardownContext } from '~/modules/worker/jobs/deployments/deployers/types';

// private-repo = public-repo's build + an SSH deploy-key Secret; stub env, @kubwave/db, and @kubwave/crypto for isolation.
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

// The deploy-key lookup pops a single-row queue; an empty queue models a deleted key.
let keyRow: unknown[] = [{ ciphertext: 'cipher' }];
mock.module('@kubwave/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: async () => keyRow }) }) }),
		update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 'dep-1' }] }) }) })
	},
	deployments: { id: 'id', imageRef: 'imageRef' },
	sshKeys: { id: 'id', privateKeyCiphertext: 'privateKeyCiphertext' }
}));
// decrypt is identity for the test — we only care the secret carries the (newline-terminated) value.
mock.module('@kubwave/crypto', () => ({ decryptSecret: (s: string) => s }));
// Stub teardownRuntime so the teardown test exercises only the private-repo reaping (Jobs + Secrets).
mock.module('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service', () => ({
	teardownRuntime: async () => {},
	// Phase-B deploy hand-off; never reached by these build-phase tests, stubbed for safety.
	reconcileRuntime: async () => ({ state: 'ready' })
}));

const { privateRepoDeployer } = await import('~/modules/worker/jobs/deployments/deployers/private-repo/deployer');

const notFound = () => Promise.reject({ code: 404 });

interface Calls {
	createdJob: boolean;
	createdSecret: boolean;
	createdPolicy: boolean;
	secretBody?: { stringData?: { id?: string } };
	policyBody?: { spec?: { egress?: Array<{ ports?: Array<{ port?: number }> }> } };
	deletedJobs: string[];
	deletedSecrets: string[];
	deletedPolicies: string[];
}

function makeCtx(opts: {
	job: unknown | 'missing';
	podLog?: string;
	calls: Calls;
	repoUrl?: string;
	builderPolicy?: unknown | 'missing';
	createSecretRejects?: unknown;
	createJobRejects?: unknown;
}): DeployContext {
	const batch = {
		readNamespacedJob: () => (opts.job === 'missing' ? notFound() : Promise.resolve(opts.job)),
		createNamespacedJob: () => {
			opts.calls.createdJob = true;
			return opts.createJobRejects ? Promise.reject(opts.createJobRejects) : Promise.resolve({});
		}
	};
	const core = {
		createNamespacedSecret: (req: { body: { stringData?: { id?: string } } }) => {
			opts.calls.createdSecret = true;
			opts.calls.secretBody = req.body;
			return opts.createSecretRejects ? Promise.reject(opts.createSecretRejects) : Promise.resolve({});
		},
		listNamespacedPod: () => Promise.resolve({ items: [{ metadata: { name: 'build-pod' } }] }),
		readNamespacedPodLog: () => Promise.resolve(opts.podLog ?? '')
	};
	const net = {
		readNamespacedNetworkPolicy: () =>
			opts.builderPolicy === 'missing'
				? notFound()
				: Promise.resolve(
						opts.builderPolicy ?? {
							spec: {
								egress: [{ to: [{ ipBlock: { cidr: '0.0.0.0/0', except: ['10.0.0.0/8', '169.254.0.0/16'] } }] }]
							}
						}
					),
		createNamespacedNetworkPolicy: (req: { body: { spec?: { egress?: Array<{ ports?: Array<{ port?: number }> }> } } }) => {
			opts.calls.createdPolicy = true;
			opts.calls.policyBody = req.body;
			return Promise.resolve({});
		}
	};
	const kc = {
		makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batch : klass === CoreV1Api ? core : klass === NetworkingV1Api ? net : {})
	} as unknown as KubeConfig;

	return {
		kc,
		namespace: 'kubwave-env-1',
		environmentId: 'env-1',
		deployment: {
			id: 'dep-1',
			serviceId: 'svc-1',
			type: 'private-repo',
			phase: 'building',
			config: {
				repoUrl: opts.repoUrl ?? 'git@github.com:org/repo.git',
				branch: 'main',
				builder: 'nixpacks',
				sshKeyId: 'key-1',
				containerPort: 3000,
				env: [],
				domains: [],
				volumes: []
			}
		} as unknown as DeployContext['deployment'],
		ingress: { className: undefined, clusterIssuer: undefined, annotations: {} },
		defaultDomainHost: null
	};
}

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	keyRow = [{ ciphertext: 'cipher' }];
});

// imageExists probes the registry over HTTP; stub it so the no-image path is deterministic.
function stubImageExists(exists: boolean) {
	globalThis.fetch = (async () => ({ status: exists ? 200 : 404 })) as unknown as typeof fetch;
}

const emptyCalls = (): Calls => ({
	createdJob: false,
	createdSecret: false,
	createdPolicy: false,
	deletedJobs: [],
	deletedSecrets: [],
	deletedPolicies: []
});

describe('privateRepoDeployer build state machine', () => {
	test('no Job/image yet → resolves the deploy key, creates the SSH Secret + SSH egress policy + build Job, reports building', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		const result = await privateRepoDeployer.reconcile(makeCtx({ job: 'missing', calls }));
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'building' });
		expect(calls.createdSecret).toBe(true);
		expect(calls.createdPolicy).toBe(true);
		expect(calls.createdJob).toBe(true);
		expect((result.events ?? []).some(e => e.step === 'build-started')).toBe(true);
	});

	test('uses the SSH port parsed from the repo URL in the egress policy', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		await privateRepoDeployer.reconcile(makeCtx({ job: 'missing', calls, repoUrl: 'ssh://git@gitea.example:2222/org/repo.git' }));
		expect(calls.policyBody?.spec?.egress?.[0]?.ports?.[0]?.port).toBe(2222);
	});

	test('skips the per-build egress policy when the static builder policy is disabled', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		const result = await privateRepoDeployer.reconcile(makeCtx({ job: 'missing', calls, builderPolicy: 'missing' }));
		expect(result.state).toBe('progressing');
		expect(calls.createdSecret).toBe(true);
		expect(calls.createdPolicy).toBe(false);
		expect(calls.createdJob).toBe(true);
	});

	test('invalid private repo URL fails before creating build artifacts', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		const result = await privateRepoDeployer.reconcile(makeCtx({ job: 'missing', calls, repoUrl: 'ssh://git@gitea.example:/org/repo.git' }));
		expect(result.state).toBe('failed');
		if (result.state === 'failed') expect(result.error).toContain('Invalid private repository SSH URL');
		expect(calls.createdSecret).toBe(false);
		expect(calls.createdPolicy).toBe(false);
		expect(calls.createdJob).toBe(false);
	});

	test('decrypted key is stored with a trailing newline (OpenSSH refuses a key without one)', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		await privateRepoDeployer.reconcile(makeCtx({ job: 'missing', calls }));
		expect(calls.secretBody?.stringData?.id).toBe('cipher\n');
	});

	test('a missing deploy key (deleted after configuration) fails with a clear, actionable error', async () => {
		stubImageExists(false);
		keyRow = []; // db returns no row for the referenced key id
		const calls = emptyCalls();
		await expect(privateRepoDeployer.reconcile(makeCtx({ job: 'missing', calls }))).rejects.toThrow(/Deploy key not found/);
		expect(calls.createdSecret).toBe(false);
		expect(calls.createdPolicy).toBe(false);
		expect(calls.createdJob).toBe(false);
	});

	test('Secret create races a concurrent tick (409) → swallowed, build still proceeds', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		const result = await privateRepoDeployer.reconcile(makeCtx({ job: 'missing', calls, createSecretRejects: { code: 409 } }));
		expect(result.state).toBe('progressing');
		expect(calls.createdSecret).toBe(true);
		expect(calls.createdPolicy).toBe(true);
		expect(calls.createdJob).toBe(true);
	});

	test('Job create races a concurrent tick (409) → swallowed, still reports building', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		const result = await privateRepoDeployer.reconcile(makeCtx({ job: 'missing', calls, createJobRejects: { code: 409 } }));
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'building' });
	});

	test('build Job still running → reports building, creates nothing', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		const result = await privateRepoDeployer.reconcile(makeCtx({ job: { status: { active: 1 } }, calls }));
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'building' });
		expect(calls.createdJob).toBe(false);
		expect(calls.createdSecret).toBe(false);
	});

	test('build Job failed → terminal failure carrying the build log tail', async () => {
		stubImageExists(false);
		const calls = emptyCalls();
		const result = await privateRepoDeployer.reconcile(
			makeCtx({ job: { status: { failed: 1 } }, podLog: 'error: permission denied (publickey)', calls })
		);
		expect(result.state).toBe('failed');
		if (result.state === 'failed') expect(result.error).toContain('permission denied');
		expect(calls.createdJob).toBe(false);
	});
});

describe('privateRepoDeployer teardown', () => {
	// teardown reaps in-flight build Jobs AND the deploy-key Secret(s), bounding how long the decrypted key lives in-cluster.
	function teardownCtx(opts: { jobs: string[]; secrets: string[]; policies?: string[]; calls: Calls }): TeardownContext {
		const batch = {
			listNamespacedJob: () => Promise.resolve({ items: opts.jobs.map(name => ({ metadata: { name } })) }),
			deleteNamespacedJob: (req: { name: string }) => {
				opts.calls.deletedJobs.push(req.name);
				return Promise.resolve({});
			}
		};
		const core = {
			listNamespacedSecret: () => Promise.resolve({ items: opts.secrets.map(name => ({ metadata: { name } })) }),
			deleteNamespacedSecret: (req: { name: string }) => {
				opts.calls.deletedSecrets.push(req.name);
				return Promise.resolve({});
			}
		};
		const net = {
			listNamespacedNetworkPolicy: () => Promise.resolve({ items: (opts.policies ?? []).map(name => ({ metadata: { name } })) }),
			deleteNamespacedNetworkPolicy: (req: { name: string }) => {
				opts.calls.deletedPolicies.push(req.name);
				return Promise.resolve({});
			}
		};
		const kc = {
			makeApiClient: (klass: unknown) => (klass === BatchV1Api ? batch : klass === CoreV1Api ? core : klass === NetworkingV1Api ? net : {})
		} as unknown as KubeConfig;
		return { kc, namespace: 'kubwave-env-1', serviceId: 'svc-1' };
	}

	test('deletes every labelled build Job, deploy-key Secret, and SSH egress policy for the service', async () => {
		const calls = emptyCalls();
		await privateRepoDeployer.teardown(
			teardownCtx({
				jobs: ['private-repo-build-dep-1'],
				secrets: ['private-repo-build-dep-1-ssh'],
				policies: ['private-repo-build-dep-1-np'],
				calls
			})
		);
		expect(calls.deletedJobs).toEqual(['private-repo-build-dep-1']);
		expect(calls.deletedSecrets).toEqual(['private-repo-build-dep-1-ssh']);
		expect(calls.deletedPolicies).toEqual(['private-repo-build-dep-1-np']);
	});

	test('no-op when there are no in-flight build artifacts', async () => {
		const calls = emptyCalls();
		await privateRepoDeployer.teardown(teardownCtx({ jobs: [], secrets: [], calls }));
		expect(calls.deletedJobs).toEqual([]);
		expect(calls.deletedSecrets).toEqual([]);
		expect(calls.deletedPolicies).toEqual([]);
	});
});
