import { describe, expect, test } from 'bun:test';
import type { AutoscalingV2Api, V1Deployment, V2HorizontalPodAutoscaler } from '@kubernetes/client-node';
import type { AutoscalingConfig, Deployment, DeploymentLogEntry, DockerImageServiceConfig } from '@kubwave/db';
import { autoscalingEnabled, buildHPA, convergeHPA, hpaMatches } from '~/modules/worker/jobs/deployments/deployers/runtime/autoscaling';
import { buildDeployment, deploymentMatchesConfig } from '~/modules/worker/jobs/deployments/deployers/runtime/deployment';

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const IMAGE_REF = 'nginx:latest';

function configWith(autoscaling?: AutoscalingConfig): DockerImageServiceConfig {
	return {
		image: 'nginx',
		tag: 'latest',
		containerPort: 8080,
		env: [],
		domains: [],
		volumes: [],
		resources: { cpuRequest: '250m', memoryRequest: '256Mi' },
		...(autoscaling ? { autoscaling } : {})
	};
}

const deployment = { serviceId: SERVICE_ID } as Deployment;

// buildHPA produces the autoscaling/v2 spec the reconciler applies.
describe('buildHPA', () => {
	test('targets the service Deployment with min/max and a cpu metric', () => {
		const hpa = buildHPA(SERVICE_ID, NAMESPACE, { enabled: true, minReplicas: 2, maxReplicas: 5, targetCpuUtilizationPercentage: 70 });
		expect(hpa.spec?.scaleTargetRef).toEqual({ apiVersion: 'apps/v1', kind: 'Deployment', name: `svc-${SERVICE_ID}` });
		expect(hpa.spec?.minReplicas).toBe(2);
		expect(hpa.spec?.maxReplicas).toBe(5);
		expect(hpa.spec?.metrics).toEqual([{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }]);
	});

	test('defaults minReplicas to 1 and emits both cpu + memory metrics', () => {
		const hpa = buildHPA(SERVICE_ID, NAMESPACE, {
			enabled: true,
			maxReplicas: 4,
			targetCpuUtilizationPercentage: 60,
			targetMemoryUtilizationPercentage: 80
		});
		expect(hpa.spec?.minReplicas).toBe(1);
		expect(hpa.spec?.metrics).toHaveLength(2);
		const mem = hpa.spec?.metrics?.find(m => m.resource?.name === 'memory');
		expect(mem?.resource?.target?.averageUtilization).toBe(80);
	});
});

// hpaMatches guards change detection: a live HPA reflecting the config must read as equal, or the worker re-writes it every tick.
describe('hpaMatches', () => {
	const desired = buildHPA(SERVICE_ID, NAMESPACE, { enabled: true, minReplicas: 1, maxReplicas: 5, targetCpuUtilizationPercentage: 70 });

	test('identical spec reads as equal', () => {
		expect(
			hpaMatches(buildHPA(SERVICE_ID, NAMESPACE, { enabled: true, minReplicas: 1, maxReplicas: 5, targetCpuUtilizationPercentage: 70 }), desired)
		).toBe(true);
	});

	test('a differing maxReplicas is a mismatch', () => {
		expect(
			hpaMatches(buildHPA(SERVICE_ID, NAMESPACE, { enabled: true, minReplicas: 1, maxReplicas: 8, targetCpuUtilizationPercentage: 70 }), desired)
		).toBe(false);
	});

	test('a differing cpu target is a mismatch', () => {
		expect(
			hpaMatches(buildHPA(SERVICE_ID, NAMESPACE, { enabled: true, minReplicas: 1, maxReplicas: 5, targetCpuUtilizationPercentage: 50 }), desired)
		).toBe(false);
	});

	test('adding a memory target is a mismatch', () => {
		const withMem = buildHPA(SERVICE_ID, NAMESPACE, {
			enabled: true,
			minReplicas: 1,
			maxReplicas: 5,
			targetCpuUtilizationPercentage: 70,
			targetMemoryUtilizationPercentage: 80
		});
		expect(hpaMatches(withMem, desired)).toBe(false);
	});

	test('ignores status and server-defaulted fields outside the owned spec', () => {
		const live = buildHPA(SERVICE_ID, NAMESPACE, { enabled: true, minReplicas: 1, maxReplicas: 5, targetCpuUtilizationPercentage: 70 });
		live.status = { currentReplicas: 3, desiredReplicas: 3, conditions: [] };
		live.metadata = { ...live.metadata, resourceVersion: '12345' };
		expect(hpaMatches(live, desired)).toBe(true);
	});
});

// The Deployment must not pin replicas while an HPA owns them; the reconciler accepts whatever the HPA scaled to.
describe('Deployment replica handling under autoscaling', () => {
	const autoscaling: AutoscalingConfig = { enabled: true, minReplicas: 1, maxReplicas: 5, targetCpuUtilizationPercentage: 70 };

	test('buildDeployment omits replicas when autoscaling is enabled', () => {
		const dep = buildDeployment(deployment, NAMESPACE, configWith(autoscaling), IMAGE_REF);
		expect(dep.spec?.replicas).toBeUndefined();
	});

	test('buildDeployment pins replicas to 1 when autoscaling is disabled', () => {
		const dep = buildDeployment(deployment, NAMESPACE, configWith(undefined), IMAGE_REF);
		expect(dep.spec?.replicas).toBe(1);
	});

	test('a Deployment scaled by the HPA still matches its autoscaling config', () => {
		const scaled = buildDeployment(deployment, NAMESPACE, configWith(autoscaling), IMAGE_REF);
		scaled.spec!.replicas = 3; // HPA scaled it up
		expect(deploymentMatchesConfig(scaled, configWith(autoscaling), IMAGE_REF, SERVICE_ID)).toBe(true);
	});

	test('a Deployment at 3 replicas does NOT match when autoscaling is disabled', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith(undefined), IMAGE_REF) as V1Deployment;
		built.spec!.replicas = 3;
		expect(deploymentMatchesConfig(built, configWith(undefined), IMAGE_REF, SERVICE_ID)).toBe(false);
	});
});

// An RWO PVC can't be HPA-scaled across nodes, so the deployer pins one replica, drops the HPA, and rolls with Recreate.
describe('volume-backed services are pinned to one instance', () => {
	const autoscaling: AutoscalingConfig = { enabled: true, minReplicas: 1, maxReplicas: 5, targetCpuUtilizationPercentage: 70 };

	function configWithVolume(as?: AutoscalingConfig): DockerImageServiceConfig {
		return { ...configWith(as), volumes: [{ name: 'data', mountPath: '/data', size: '1Gi' }] };
	}

	test('pins replicas to 1 even when autoscaling is enabled in config', () => {
		const dep = buildDeployment(deployment, NAMESPACE, configWithVolume(autoscaling), IMAGE_REF);
		expect(dep.spec?.replicas).toBe(1);
	});

	test('rolls with the Recreate strategy when a volume is present', () => {
		const dep = buildDeployment(deployment, NAMESPACE, configWithVolume(autoscaling), IMAGE_REF);
		expect(dep.spec?.strategy?.type).toBe('Recreate');
	});

	test('stateless services keep the default (RollingUpdate) strategy', () => {
		const dep = buildDeployment(deployment, NAMESPACE, configWith(autoscaling), IMAGE_REF);
		expect(dep.spec?.strategy).toBeUndefined();
	});

	test('a live volume Deployment at >1 replica does NOT match (HPA must be undone)', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWithVolume(autoscaling), IMAGE_REF) as V1Deployment;
		built.spec!.replicas = 4; // a stale HPA had scaled it up
		expect(deploymentMatchesConfig(built, configWithVolume(autoscaling), IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	test('a live volume Deployment still on RollingUpdate does NOT match', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWithVolume(), IMAGE_REF) as V1Deployment;
		built.spec!.strategy = { type: 'RollingUpdate' }; // created before the Recreate fix
		expect(deploymentMatchesConfig(built, configWithVolume(), IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	test('a converged volume Deployment (1 replica, Recreate) matches', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWithVolume(autoscaling), IMAGE_REF) as V1Deployment;
		expect(deploymentMatchesConfig(built, configWithVolume(autoscaling), IMAGE_REF, SERVICE_ID)).toBe(true);
	});
});

// The gate that drives every convergeHPA branch and the Deployment's replica handling.
describe('autoscalingEnabled', () => {
	const enabled: AutoscalingConfig = { enabled: true, minReplicas: 1, maxReplicas: 5, targetCpuUtilizationPercentage: 70 };

	test('true for an enabled config with a maxReplicas and no volume', () => {
		expect(autoscalingEnabled(configWith(enabled))).toBe(true);
	});

	test('false when autoscaling is absent or disabled', () => {
		expect(autoscalingEnabled(configWith(undefined))).toBe(false);
		expect(autoscalingEnabled(configWith({ ...enabled, enabled: false }))).toBe(false);
	});

	test('false when enabled but maxReplicas is missing', () => {
		expect(autoscalingEnabled(configWith({ enabled: true, minReplicas: 1 } as AutoscalingConfig))).toBe(false);
	});

	test('false for a volume-backed service even when autoscaling is enabled (RWO single-attach)', () => {
		const withVol = { ...configWith(enabled), volumes: [{ name: 'data', mountPath: '/data', size: '1Gi' }] };
		expect(autoscalingEnabled(withVol)).toBe(false);
	});
});

// Fake AutoscalingV2Api over a name→HPA map; records create/replace/delete and folds 404 on read.
function fakeHpaApi(initial: Record<string, V2HorizontalPodAutoscaler> = {}) {
	const store = { ...initial };
	const calls = { create: 0, replace: 0, delete: 0 };
	const api = {
		readNamespacedHorizontalPodAutoscaler: async ({ name }: { name: string }) => {
			const h = store[name];
			if (!h) throw { code: 404 };
			return h;
		},
		createNamespacedHorizontalPodAutoscaler: async ({ body }: { body: V2HorizontalPodAutoscaler }) => {
			calls.create++;
			store[body.metadata!.name!] = body;
			return body;
		},
		replaceNamespacedHorizontalPodAutoscaler: async ({ name, body }: { name: string; body: V2HorizontalPodAutoscaler }) => {
			calls.replace++;
			store[name] = body;
			return body;
		},
		deleteNamespacedHorizontalPodAutoscaler: async ({ name }: { name: string }) => {
			calls.delete++;
			delete store[name];
			return {};
		}
	} as unknown as AutoscalingV2Api;
	return { api, calls, store };
}

const HPA_NAME = `svc-${SERVICE_ID}`;

describe('convergeHPA', () => {
	const enabled: AutoscalingConfig = { enabled: true, minReplicas: 2, maxReplicas: 5, targetCpuUtilizationPercentage: 70 };

	test('creates the HPA when autoscaling is enabled and none is live', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeHpaApi();
		await convergeHPA(api, NAMESPACE, SERVICE_ID, configWith(enabled), events);
		expect(calls).toEqual({ create: 1, replace: 0, delete: 0 });
		expect(events[0]?.step).toBe('hpa-converged');
		expect(events[0]?.message).toContain('Created HPA');
	});

	test('no-op when the live HPA already matches the desired spec', async () => {
		const events: DeploymentLogEntry[] = [];
		const live = buildHPA(SERVICE_ID, NAMESPACE, enabled);
		const { api, calls } = fakeHpaApi({ [HPA_NAME]: live });
		await convergeHPA(api, NAMESPACE, SERVICE_ID, configWith(enabled), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(events).toEqual([]);
	});

	test('replaces the live HPA when an owned field changed', async () => {
		const events: DeploymentLogEntry[] = [];
		// live max=5, desired max=8
		const live = buildHPA(SERVICE_ID, NAMESPACE, enabled);
		const { api, calls } = fakeHpaApi({ [HPA_NAME]: live });
		await convergeHPA(api, NAMESPACE, SERVICE_ID, configWith({ ...enabled, maxReplicas: 8 }), events);
		expect(calls).toEqual({ create: 0, replace: 1, delete: 0 });
		expect(events[0]?.message).toContain('Updated HPA');
	});

	test('deletes the live HPA when autoscaling is disabled', async () => {
		const events: DeploymentLogEntry[] = [];
		const live = buildHPA(SERVICE_ID, NAMESPACE, enabled);
		const { api, calls } = fakeHpaApi({ [HPA_NAME]: live });
		await convergeHPA(api, NAMESPACE, SERVICE_ID, configWith(undefined), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 1 });
		expect(events[0]?.message).toContain('Removed HPA');
	});

	test('no-op when autoscaling is disabled and no HPA is live', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeHpaApi();
		await convergeHPA(api, NAMESPACE, SERVICE_ID, configWith(undefined), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(events).toEqual([]);
	});
});
