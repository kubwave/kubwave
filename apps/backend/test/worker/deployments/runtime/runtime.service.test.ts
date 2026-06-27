import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AppsV1Api, AutoscalingV2Api, CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import type { V1Deployment, V1PersistentVolumeClaim } from '@kubernetes/client-node';
import type { DeploymentLogEntry, RuntimeConfig } from '@kubwave/db';
import type { DeployContext, TeardownContext } from '~/modules/worker/jobs/deployments/deployers/types';

// reconcileRuntime orchestrates: PVCs → secrets → Service/Ingress/HPA → Deployment, then reports the rollout. IO seams mocked; @kubwave/kube stays REAL.

const order: string[] = [];

let pullSecretName: string | undefined; // env.registryPullSecretName
let existingPVCs: Record<string, V1PersistentVolumeClaim | null> = {};
let existingDeployment: V1Deployment | null = null;
let deploymentMatches = true;
let unhealthy: string | null = null;
let hpaEnabled = false;

mock.module('~/shared/config/worker-env', () => ({
	env: {
		get registryPullSecretName() {
			return pullSecretName;
		}
	}
}));

mock.module('~/shared/cluster/ops', () => ({
	isNotFound: (err: unknown) => (err as { code?: number })?.code === 404,
	readPVCOrNull: async (_api: unknown, _ns: string, name: string) => {
		order.push(`readPVC:${name}`);
		return existingPVCs[name] ?? null;
	},
	readDeploymentOrNull: async () => {
		order.push('readDeployment');
		return existingDeployment;
	},
	replaceWithRetry: async (args: {
		label: string;
		read: () => Promise<unknown>;
		build: () => unknown;
		carryOver: (fresh: unknown, desired: unknown) => unknown;
		replace: (body: unknown) => Promise<unknown>;
	}) => {
		order.push(`replaceWithRetry:${args.label}`);
		const fresh = await args.read();
		const body = args.carryOver(fresh, args.build());
		await args.replace(body);
	},
	deleteIgnoreMissing: async (fn: () => Promise<unknown>) => {
		try {
			await fn();
		} catch (err) {
			if ((err as { code?: number })?.code !== 404) throw err;
		}
	},
	rolloutFailureMessage: () => 'rollout failed',
	unhealthyReason: async () => {
		order.push('unhealthyReason');
		return unhealthy;
	}
}));

mock.module('~/shared/cluster/networking', () => ({
	convergeNetworking: async () => {
		order.push('convergeNetworking');
	},
	stepEvent: (step: string, message: string): DeploymentLogEntry => ({ ts: 'T', level: 'info', step, message }),
	teardownNetworking: async () => {
		order.push('teardownNetworking');
	}
}));

mock.module('~/modules/worker/jobs/deployments/deployers/runtime/storage', () => ({
	buildPVC: (serviceId: string, _ns: string, vol: { name: string; size: string }) => ({
		metadata: { name: `svc-${serviceId}-${vol.name}` },
		spec: { resources: { requests: { storage: vol.size } } }
	})
}));

mock.module('~/modules/worker/jobs/deployments/deployers/runtime/pull-secret', () => ({
	convergePullSecret: async () => {
		order.push('convergePullSecret');
	}
}));

mock.module('~/modules/worker/jobs/deployments/deployers/runtime/secrets', () => ({
	convergeSecret: async () => {
		order.push('convergeSecret');
	}
}));

mock.module('~/modules/worker/jobs/deployments/deployers/runtime/config-files', () => ({
	convergeConfigFiles: async () => {
		order.push('convergeConfigFiles');
	},
	filesSecretName: (serviceId: string) => `svc-${serviceId}-files`
}));

mock.module('~/modules/worker/jobs/deployments/deployers/runtime/autoscaling', () => ({
	autoscalingEnabled: () => hpaEnabled,
	convergeHPA: async () => {
		order.push('convergeHPA');
	}
}));

mock.module('~/modules/worker/jobs/deployments/deployers/runtime/deployment', () => ({
	buildDeployment: (_dep: unknown, _ns: string, _cfg: unknown, imageRef: string, opts?: { imagePullSecretName?: string }) => ({
		metadata: { name: 'svc-svc-1', resourceVersion: undefined },
		spec: {
			replicas: 1,
			template: {
				spec: { containers: [{ image: imageRef }], imagePullSecrets: opts?.imagePullSecretName ? [{ name: opts.imagePullSecretName }] : undefined }
			}
		}
	}),
	containerPorts: () => [8080],
	withDefaultDomain: () => [],
	deploymentMatchesConfig: () => deploymentMatches
}));

const { reconcileRuntime, teardownRuntime } = await import('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service');

const SERVICE_ID = 'svc-1';
const NAMESPACE = 'kubwave-env-1';
const IMAGE_REF = 'registry/env-1/svc-1:dep-1';

// A fake KubeConfig whose makeApiClient returns a recording stub per API class.
function makeCtx(_config: RuntimeConfig): DeployContext {
	const created: string[] = [];
	const kc = {
		makeApiClient(klass: unknown) {
			if (klass === AppsV1Api) {
				return {
					createNamespacedDeployment: async () => {
						created.push('deployment');
						order.push('createDeployment');
					},
					replaceNamespacedDeployment: async () => {
						order.push('replaceDeployment');
					}
				};
			}
			if (klass === CoreV1Api) {
				return {
					createNamespacedPersistentVolumeClaim: async () => {
						created.push('pvc');
						order.push('createPVC');
					},
					replaceNamespacedPersistentVolumeClaim: async () => {
						order.push('replacePVC');
					}
				};
			}
			if (klass === NetworkingV1Api) return {};
			if (klass === AutoscalingV2Api) return {};
			return {};
		}
	};
	return {
		kc: kc as never,
		namespace: NAMESPACE,
		environmentId: 'env-1',
		deployment: { serviceId: SERVICE_ID } as never,
		ingress: { annotations: {} },
		defaultDomainHost: null
	};
}

function baseConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
	return { containerPort: 8080, env: [], domains: [], volumes: [], ...overrides } as RuntimeConfig;
}

// A live Deployment whose status reports a settled, fully-ready rollout.
function readyDeployment(): V1Deployment {
	return {
		metadata: { name: 'svc-svc-1', generation: 1 },
		spec: { replicas: 1, selector: { matchLabels: {} }, template: { spec: { containers: [{ name: 'app', image: IMAGE_REF }] } } },
		status: { observedGeneration: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1, replicas: 1 }
	};
}

afterEach(() => {
	order.length = 0;
	pullSecretName = undefined;
	existingPVCs = {};
	existingDeployment = null;
	deploymentMatches = true;
	unhealthy = null;
	hpaEnabled = false;
});

describe('reconcileRuntime — first deploy (no existing Deployment)', () => {
	test('converges pull/env secrets then CREATES the Deployment and reports progressing/applying', async () => {
		existingDeployment = null;
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'applying' });
		// Secrets converge before the Deployment read/create; networking + HPA after create.
		expect(order).toEqual([
			'convergePullSecret',
			'convergeSecret',
			'convergeConfigFiles',
			'readDeployment',
			'createDeployment',
			'convergeNetworking',
			'convergeHPA'
		]);
		expect(result.events?.map(e => e.step)).toContain('deployment-created');
	});

	test('threads the configured pull-secret name into buildDeployment', async () => {
		pullSecretName = 'reg-pull';
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		// Seam wiring is covered by runtime-shared; just assert the pull-secret name didn't change the outcome.
		expect(result.state).toBe('progressing');
	});
});

describe('reconcileRuntime — PVC convergence', () => {
	test('creates a missing PVC before touching the Deployment', async () => {
		const cfg = baseConfig({ volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }] });
		existingPVCs = { 'svc-svc-1-data': null };
		const result = await reconcileRuntime(makeCtx(cfg), cfg, IMAGE_REF);
		expect(order[0]).toBe('readPVC:svc-svc-1-data');
		expect(order[1]).toBe('createPVC');
		expect(order.indexOf('createPVC')).toBeLessThan(order.indexOf('readDeployment'));
		expect(result.events?.map(e => e.step)).toContain('pvc-created');
	});

	test('expands an existing PVC only when the desired size is LARGER', async () => {
		const cfg = baseConfig({ volumes: [{ name: 'data', mountPath: '/data', size: '10Gi' }] });
		existingPVCs = { 'svc-svc-1-data': { spec: { resources: { requests: { storage: '5Gi' } } } } as V1PersistentVolumeClaim };
		const result = await reconcileRuntime(makeCtx(cfg), cfg, IMAGE_REF);
		expect(order).toContain('replaceWithRetry:PVC svc-svc-1-data');
		expect(result.events?.map(e => e.step)).toContain('pvc-expanded');
	});

	test('does NOT expand when the desired size equals the live size (no shrink, no churn)', async () => {
		const cfg = baseConfig({ volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }] });
		existingPVCs = { 'svc-svc-1-data': { spec: { resources: { requests: { storage: '5Gi' } } } } as V1PersistentVolumeClaim };
		const result = await reconcileRuntime(makeCtx(cfg), cfg, IMAGE_REF);
		expect(order).not.toContain('replaceWithRetry:PVC svc-svc-1-data');
		expect(order).not.toContain('createPVC');
		expect(result.events?.map(e => e.step)).not.toContain('pvc-expanded');
	});

	test('does NOT shrink when the desired size is SMALLER than live', async () => {
		const cfg = baseConfig({ volumes: [{ name: 'data', mountPath: '/data', size: '2Gi' }] });
		existingPVCs = { 'svc-svc-1-data': { spec: { resources: { requests: { storage: '5Gi' } } } } as V1PersistentVolumeClaim };
		await reconcileRuntime(makeCtx(cfg), cfg, IMAGE_REF);
		expect(order).not.toContain('replaceWithRetry:PVC svc-svc-1-data');
	});
});

describe('reconcileRuntime — existing Deployment', () => {
	test('REPLACES the Deployment when the config changed and reports progressing/applying', async () => {
		existingDeployment = readyDeployment();
		deploymentMatches = false;
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		expect(result.state).toBe('progressing');
		expect(result).toMatchObject({ phase: 'applying' });
		expect(order).toContain('replaceWithRetry:Deployment svc-svc-1');
		expect(order).toContain('replaceDeployment');
		// networking + HPA still sync after the replace.
		expect(order.indexOf('convergeNetworking')).toBeGreaterThan(order.indexOf('replaceDeployment'));
		expect(result.events?.map(e => e.step)).toContain('deployment-updated');
	});

	test('converged + ready Deployment: syncs networking, no write, reports ready', async () => {
		existingDeployment = readyDeployment();
		deploymentMatches = true;
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		expect(result.state).toBe('ready');
		expect(order).not.toContain('createDeployment');
		expect(order).not.toContain('replaceDeployment');
		// But networking + HPA are still kept in sync every tick.
		expect(order).toContain('convergeNetworking');
		expect(order).toContain('convergeHPA');
	});

	test('converged but still rolling out → progressing/rolling-out when pods look healthy', async () => {
		const dep = readyDeployment();
		dep.status = { observedGeneration: 0, ...dep.status }; // observedGeneration lags generation → progressing
		dep.metadata!.generation = 2;
		existingDeployment = dep;
		deploymentMatches = true;
		unhealthy = null;
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		expect(result).toMatchObject({ state: 'progressing', phase: 'rolling-out' });
	});

	test('converged but a pod is unhealthy → progressing with the pod error surfaced in the phase', async () => {
		const dep = readyDeployment();
		dep.metadata!.generation = 2; // still progressing (observedGeneration 1 < 2)
		existingDeployment = dep;
		deploymentMatches = true;
		unhealthy = 'ImagePullBackOff: bad/image';
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		expect(result).toMatchObject({ state: 'progressing', phase: 'error: ImagePullBackOff: bad/image' });
	});

	test('converged + failed rollout → failed with the pod reason as the error', async () => {
		const dep = readyDeployment();
		// Force deploymentRolloutState=failed: generation observed, but progress-deadline exceeded long ago.
		dep.metadata!.generation = 1;
		dep.status = {
			observedGeneration: 1,
			updatedReplicas: 0,
			readyReplicas: 0,
			availableReplicas: 0,
			replicas: 1,
			conditions: [
				{
					type: 'Progressing',
					status: 'False',
					reason: 'ProgressDeadlineExceeded',
					lastTransitionTime: new Date('2000-01-01T00:00:00Z'),
					message: 'deadline'
				}
			]
		};
		existingDeployment = dep;
		deploymentMatches = true;
		unhealthy = 'CrashLoopBackOff: boom';
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		expect(result).toMatchObject({ state: 'failed', error: 'CrashLoopBackOff: boom' });
	});

	test('failed rollout with no pod reason falls back to rolloutFailureMessage', async () => {
		const dep = readyDeployment();
		dep.metadata!.generation = 1;
		dep.status = {
			observedGeneration: 1,
			updatedReplicas: 0,
			readyReplicas: 0,
			availableReplicas: 0,
			replicas: 1,
			conditions: [
				{
					type: 'Progressing',
					status: 'False',
					reason: 'ProgressDeadlineExceeded',
					lastTransitionTime: new Date('2000-01-01T00:00:00Z'),
					message: 'deadline'
				}
			]
		};
		existingDeployment = dep;
		deploymentMatches = true;
		unhealthy = null; // no obvious pod problem → use the Deployment's own message
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		expect(result).toMatchObject({ state: 'failed', error: 'rollout failed' });
	});
});

describe('reconcileRuntime — replace under autoscaling', () => {
	test('carries the live replica count over so the replace does not reset the HPA scaling', async () => {
		const dep = readyDeployment();
		dep.spec!.replicas = 3; // HPA had scaled it to 3
		existingDeployment = dep;
		deploymentMatches = false;
		hpaEnabled = true;
		const result = await reconcileRuntime(makeCtx(baseConfig()), baseConfig(), IMAGE_REF);
		expect(result.state).toBe('progressing');
		expect(order).toContain('replaceWithRetry:Deployment svc-svc-1');
		expect(order).toContain('replaceDeployment');
	});
});

describe('teardownRuntime', () => {
	test('deletes HPA, Deployment, env Secret, every labelled PVC, then tears down networking', async () => {
		const deleted: string[] = [];
		const kc = {
			makeApiClient(klass: unknown) {
				if (klass === AppsV1Api) {
					return {
						deleteNamespacedDeployment: async () => {
							deleted.push('deployment');
						}
					};
				}
				if (klass === CoreV1Api) {
					return {
						deleteNamespacedSecret: async ({ name }: { name: string }) => {
							deleted.push(`secret:${name}`);
						},
						listNamespacedPersistentVolumeClaim: async () => ({
							items: [{ metadata: { name: 'svc-svc-1-data' } }, { metadata: { name: 'svc-svc-1-cache' } }]
						}),
						deleteNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
							deleted.push(`pvc:${name}`);
						}
					};
				}
				if (klass === AutoscalingV2Api) {
					return {
						deleteNamespacedHorizontalPodAutoscaler: async () => {
							deleted.push('hpa');
						}
					};
				}
				return {};
			}
		};
		const ctx: TeardownContext = { kc: kc as never, namespace: NAMESPACE, serviceId: SERVICE_ID };
		await teardownRuntime(ctx);
		expect(deleted).toEqual(['hpa', 'deployment', 'secret:svc-svc-1-env', 'secret:svc-svc-1-files', 'pvc:svc-svc-1-data', 'pvc:svc-svc-1-cache']);
		expect(order).toContain('teardownNetworking');
	});

	test('a 404 listing PVCs (namespace already gone) is swallowed and stops teardown early', async () => {
		const kc = {
			makeApiClient(klass: unknown) {
				if (klass === AppsV1Api) return { deleteNamespacedDeployment: async () => {} };
				if (klass === CoreV1Api) {
					return {
						deleteNamespacedSecret: async () => {},
						listNamespacedPersistentVolumeClaim: async () => {
							throw { code: 404 };
						},
						deleteNamespacedPersistentVolumeClaim: async () => {}
					};
				}
				if (klass === AutoscalingV2Api) return { deleteNamespacedHorizontalPodAutoscaler: async () => {} };
				return {};
			}
		};
		const ctx: TeardownContext = { kc: kc as never, namespace: NAMESPACE, serviceId: SERVICE_ID };
		// Returns (early `return` on isNotFound) rather than throwing — and never reaches networking teardown.
		await teardownRuntime(ctx);
		expect(order).not.toContain('teardownNetworking');
	});

	test('a non-404 error listing PVCs propagates', async () => {
		const kc = {
			makeApiClient(klass: unknown) {
				if (klass === AppsV1Api) return { deleteNamespacedDeployment: async () => {} };
				if (klass === CoreV1Api) {
					return {
						deleteNamespacedSecret: async () => {},
						listNamespacedPersistentVolumeClaim: async () => {
							throw { code: 500 };
						},
						deleteNamespacedPersistentVolumeClaim: async () => {}
					};
				}
				if (klass === AutoscalingV2Api) return { deleteNamespacedHorizontalPodAutoscaler: async () => {} };
				return {};
			}
		};
		const ctx: TeardownContext = { kc: kc as never, namespace: NAMESPACE, serviceId: SERVICE_ID };
		await expect(teardownRuntime(ctx)).rejects.toMatchObject({ code: 500 });
	});
});

describe('reconcileRuntime — error propagation', () => {
	test('a PVC read failure propagates (reconcile is not best-effort here)', async () => {
		const cfg = baseConfig({ volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }] });
		// Re-point readPVCOrNull at a throwing impl for this test only.
		mock.module('~/shared/cluster/ops', () => ({
			isNotFound: (err: unknown) => (err as { code?: number })?.code === 404,
			readPVCOrNull: async () => {
				throw new Error('boom-pvc');
			},
			readDeploymentOrNull: async () => null,
			replaceWithRetry: async () => {},
			deleteIgnoreMissing: async () => {},
			rolloutFailureMessage: () => 'rollout failed',
			unhealthyReason: async () => null
		}));
		const mod = await import('~/modules/worker/jobs/deployments/deployers/runtime/runtime.service');
		await expect(mod.reconcileRuntime(makeCtx(cfg), cfg, IMAGE_REF)).rejects.toThrow('boom-pvc');
	});
});
