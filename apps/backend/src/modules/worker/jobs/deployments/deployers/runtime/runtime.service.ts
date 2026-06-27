import { AppsV1Api, AutoscalingV2Api, CoreV1Api, NetworkingV1Api, type V1Deployment } from '@kubernetes/client-node';
import type { DeploymentLogEntry, RuntimeConfig } from '@kubwave/db';
import { deploymentRolloutState, LABEL_SERVICE_ID, parseMemoryToBytes, pvcName, resourceName, secretName } from '@kubwave/kube';
import {
	deleteIgnoreMissing,
	isNotFound,
	readDeploymentOrNull,
	readPVCOrNull,
	replaceWithRetry,
	rolloutFailureMessage,
	unhealthyReason
} from '../../../../../../shared/cluster/ops.js';
import { convergeNetworking, stepEvent, teardownNetworking } from '../../../../../../shared/cluster/networking.js';
import { env } from '../../../../../../shared/config/worker-env.js';
import { tenantIsolation } from '../../../../../../shared/cluster/isolation.js';
import type { DeployContext, ReconcileResult, TeardownContext } from '../types.js';
import { autoscalingEnabled, convergeHPA } from './autoscaling.js';
import { buildDeployment, containerPorts, deploymentMatchesConfig, withDefaultDomain } from './deployment.js';
import { runtimeClassForService } from './runtime-class.js';
import { convergePullSecret } from './pull-secret.js';
import { convergeSecret } from './secrets.js';
import { convergeConfigFiles, filesSecretName } from './config-files.js';
import { buildPVC } from './storage.js';

async function convergePersistentVolumes(
	coreApi: CoreV1Api,
	namespace: string,
	serviceId: string,
	volumes: RuntimeConfig['volumes'],
	events: DeploymentLogEntry[]
): Promise<void> {
	// Converge PVCs before the Deployment references them. Storage is the only mutable field and only grows in place; shrinks are rejected upstream and we never recreate (destroys data).
	for (const vol of volumes) {
		const pvcName_ = pvcName(serviceId, vol.name);
		const existingPVC = await readPVCOrNull(coreApi, namespace, pvcName_);
		if (!existingPVC) {
			await coreApi.createNamespacedPersistentVolumeClaim({ namespace, body: buildPVC(serviceId, namespace, vol) });
			events.push(stepEvent('pvc-created', `Created PVC ${pvcName_} (${vol.size})`));
			continue;
		}

		const liveBytes = parseMemoryToBytes(existingPVC.spec?.resources?.requests?.storage);
		const desiredBytes = parseMemoryToBytes(vol.size);
		if (liveBytes == null || desiredBytes == null || desiredBytes <= liveBytes) continue;

		// Replace the live PVC with only its storage request bumped, preserving server-managed fields via carryOver (same retry path as the rest).
		await replaceWithRetry({
			label: `PVC ${pvcName_}`,
			read: () => readPVCOrNull(coreApi, namespace, pvcName_),
			build: () => existingPVC,
			carryOver: fresh => {
				fresh.spec = fresh.spec ?? {};
				fresh.spec.resources = fresh.spec.resources ?? {};
				fresh.spec.resources.requests = { ...fresh.spec.resources.requests, storage: vol.size };
				return fresh;
			},
			replace: body => coreApi.replaceNamespacedPersistentVolumeClaim({ name: pvcName_, namespace, body })
		});
		events.push(stepEvent('pvc-expanded', `Expanded PVC ${pvcName_} to ${vol.size}`));
	}
}

async function syncRuntimeNetworking(args: {
	coreApi: CoreV1Api;
	netApi: NetworkingV1Api;
	autoscalingApi: AutoscalingV2Api;
	ctx: DeployContext;
	serviceId: string;
	config: RuntimeConfig;
	ports: ReturnType<typeof containerPorts>;
	domains: ReturnType<typeof withDefaultDomain>;
	events: DeploymentLogEntry[];
}): Promise<void> {
	await convergeNetworking({
		coreApi: args.coreApi,
		netApi: args.netApi,
		namespace: args.ctx.namespace,
		deployment: args.ctx.deployment,
		ports: args.ports,
		domains: args.domains,
		ingress: args.ctx.ingress,
		events: args.events
	});
	await convergeHPA(args.autoscalingApi, args.ctx.namespace, args.serviceId, args.config, args.events);
}

async function rolloutResult(
	coreApi: CoreV1Api,
	namespace: string,
	serviceId: string,
	existing: V1Deployment,
	events: DeploymentLogEntry[]
): Promise<ReconcileResult> {
	const state = deploymentRolloutState(existing);
	if (state === 'ready') return { state: 'ready', events };
	if (state === 'failed') {
		const reason = (await unhealthyReason(coreApi, namespace, serviceId)) ?? rolloutFailureMessage(existing);
		return { state: 'failed', error: reason, events };
	}
	const bad = await unhealthyReason(coreApi, namespace, serviceId);
	return { state: 'progressing', phase: bad ? `error: ${bad}` : 'rolling-out', events };
}

// Shared deploy core: converge every cluster resource for the config + image ref and report rollout state. Idempotent - called every tick until terminal.
export async function reconcileRuntime(ctx: DeployContext, config: RuntimeConfig, imageRef: string): Promise<ReconcileResult> {
	const serviceId = ctx.deployment.serviceId;
	const name = resourceName(serviceId);
	const appsApi = ctx.kc.makeApiClient(AppsV1Api);
	const coreApi = ctx.kc.makeApiClient(CoreV1Api);
	const netApi = ctx.kc.makeApiClient(NetworkingV1Api);
	const autoscalingApi = ctx.kc.makeApiClient(AutoscalingV2Api);
	const imagePullSecretName = env.registryPullSecretName || undefined;
	// Same source the namespace reconciler stamps as the PSS enforce label, so pod hardening and the admission level can't diverge.
	const podSecurityEnforce = tenantIsolation.podSecurityEnforce;
	const runtimeClass = runtimeClassForService(ctx.deployment.type, tenantIsolation.runtimeClass) || undefined;
	const desiredPorts = containerPorts(config);
	const desiredDomains = withDefaultDomain(config, ctx.defaultDomainHost);

	// Actions this pass performed (only create/replace/converge writes push here); phase + terminal entries are the reconciler's.
	const events: DeploymentLogEntry[] = [];

	await convergePersistentVolumes(coreApi, ctx.namespace, serviceId, config.volumes, events);

	// Pull/env/config-files Secrets before the Deployment references them, so a value/content change lands before its rollout.
	await convergePullSecret(coreApi, ctx.namespace, events);
	await convergeSecret(coreApi, ctx.namespace, serviceId, config, events);
	await convergeConfigFiles(coreApi, ctx.namespace, serviceId, config, events);

	// Keep Service + Ingress + HPA in sync; the HPA references the Deployment by name, so converging it alongside networking is safe.
	const syncNetworking = async () => {
		await syncRuntimeNetworking({
			coreApi,
			netApi,
			autoscalingApi,
			ctx,
			serviceId,
			config,
			ports: desiredPorts,
			domains: desiredDomains,
			events
		});
	};

	const existing = await readDeploymentOrNull(appsApi, ctx.namespace, name);

	// Write the Deployment ONLY when missing or the config changed; after a write the status is stale (observedGeneration lags), so report progressing.
	if (!existing) {
		await appsApi.createNamespacedDeployment({
			namespace: ctx.namespace,
			body: buildDeployment(ctx.deployment, ctx.namespace, config, imageRef, { imagePullSecretName, podSecurityEnforce, runtimeClass })
		});
		events.push(stepEvent('deployment-created', `Created Deployment ${name} with image ${imageRef}`));
		await syncNetworking();
		return { state: 'progressing', phase: 'applying', events };
	}
	if (!deploymentMatchesConfig(existing, config, imageRef, serviceId, podSecurityEnforce, runtimeClass)) {
		await replaceWithRetry({
			label: `Deployment ${name}`,
			read: () => readDeploymentOrNull(appsApi, ctx.namespace, name),
			build: () => buildDeployment(ctx.deployment, ctx.namespace, config, imageRef, { imagePullSecretName, podSecurityEnforce, runtimeClass }),
			carryOver: (fresh, desired) => {
				desired.metadata = { ...desired.metadata, resourceVersion: fresh.metadata?.resourceVersion ?? undefined };
				// Under HPA, carry over the live replica count so the replace doesn't reset its scaling to the default.
				if (autoscalingEnabled(config) && fresh.spec?.replicas != null && desired.spec) {
					desired.spec.replicas = fresh.spec.replicas;
				}
				return desired;
			},
			replace: body => appsApi.replaceNamespacedDeployment({ name, namespace: ctx.namespace, body })
		});
		events.push(stepEvent('deployment-updated', `Updated Deployment ${name} to image ${imageRef}`));
		await syncNetworking();
		return { state: 'progressing', phase: 'applying', events };
	}

	// Already converged - keep networking in sync, then evaluate the rollout.
	await syncNetworking();
	return rolloutResult(coreApi, ctx.namespace, serviceId, existing, events);
}

// Shared teardown: delete every cluster resource the deploy core created; type-specific deployers wrap this (e.g. to reap a build Job).
export async function teardownRuntime(ctx: TeardownContext): Promise<void> {
	const name = resourceName(ctx.serviceId);
	const appsApi = ctx.kc.makeApiClient(AppsV1Api);
	const coreApi = ctx.kc.makeApiClient(CoreV1Api);
	const netApi = ctx.kc.makeApiClient(NetworkingV1Api);
	const autoscalingApi = ctx.kc.makeApiClient(AutoscalingV2Api);
	await deleteIgnoreMissing(() => autoscalingApi.deleteNamespacedHorizontalPodAutoscaler({ name, namespace: ctx.namespace }));
	await deleteIgnoreMissing(() => appsApi.deleteNamespacedDeployment({ name, namespace: ctx.namespace, propagationPolicy: 'Background' }));
	await deleteIgnoreMissing(() => coreApi.deleteNamespacedSecret({ name: secretName(ctx.serviceId), namespace: ctx.namespace }));
	await deleteIgnoreMissing(() => coreApi.deleteNamespacedSecret({ name: filesSecretName(ctx.serviceId), namespace: ctx.namespace }));
	// No volume list at teardown time, so list+delete every PVC matching the service label.
	let pvcs;
	try {
		pvcs = await coreApi.listNamespacedPersistentVolumeClaim({
			namespace: ctx.namespace,
			labelSelector: `${LABEL_SERVICE_ID}=${ctx.serviceId}`
		});
	} catch (err) {
		if (isNotFound(err)) return;
		throw err;
	}
	for (const pvc of pvcs.items) {
		await deleteIgnoreMissing(() => coreApi.deleteNamespacedPersistentVolumeClaim({ name: pvc.metadata!.name!, namespace: ctx.namespace }));
	}
	await teardownNetworking({ coreApi, netApi, namespace: ctx.namespace, serviceId: ctx.serviceId });
}
