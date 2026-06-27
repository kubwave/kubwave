import { BatchV1Api, CoreV1Api } from '@kubernetes/client-node';
import type { DockerfileServiceConfig } from '@kubwave/db';
import { LABEL_SERVICE_ID } from '@kubwave/kube';
import { createIgnoreConflict, deleteIgnoreMissing, readConfigMapOrNull } from '../../../../../../shared/cluster/ops.js';
import { env } from '../../../../../../shared/config/worker-env.js';
import { teardownRuntime } from '../runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from '../types.js';
import { BUILDER_CONTAINER, BUILDER_LABEL_SELECTOR, buildJobLabels, reapBuildJobs, runBuildReconcile } from '../../builds/service.js';
import { buildConfigMapName, buildJobName, buildDockerfileBuildJob } from './job.js';

// Builds a pasted Dockerfile via a BuildKit Job; the build->deploy state machine is shared (runBuildReconcile), only the ConfigMap step is here.

async function ensureBuildConfigMap(api: CoreV1Api, namespace: string, serviceId: string, deploymentId: string, dockerfile: string): Promise<void> {
	const name = buildConfigMapName(deploymentId);
	if (await readConfigMapOrNull(api, namespace, name)) return;
	await createIgnoreConflict(() =>
		api.createNamespacedConfigMap({
			namespace,
			body: {
				apiVersion: 'v1',
				kind: 'ConfigMap',
				metadata: { name, namespace, labels: buildJobLabels(serviceId, deploymentId) },
				data: { Dockerfile: dockerfile }
			}
		})
	);
}

// Delete a build Job (and its pods) + its Dockerfile ConfigMap. Tolerates already-gone objects.
export async function deleteBuildResources(kc: DeployContext['kc'], namespace: string, deploymentId: string): Promise<void> {
	const batchApi = kc.makeApiClient(BatchV1Api);
	const coreApi = kc.makeApiClient(CoreV1Api);
	await deleteIgnoreMissing(() => batchApi.deleteNamespacedJob({ name: buildJobName(deploymentId), namespace, propagationPolicy: 'Background' }));
	await deleteIgnoreMissing(() => coreApi.deleteNamespacedConfigMap({ name: buildConfigMapName(deploymentId), namespace }));
}

export const dockerfileDeployer: Deployer = {
	type: 'dockerfile',

	async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
		const config = ctx.deployment.config as DockerfileServiceConfig;
		return runBuildReconcile(ctx, config, {
			jobName: buildJobName(ctx.deployment.id),
			buildContainers: [BUILDER_CONTAINER],
			startMessage: 'Building image from Dockerfile',
			notConfiguredError: 'Dockerfile builds are not available: no build registry is configured (REGISTRY_ENDPOINT).',
			startBuild: async ({ coreApi, batchApi, namespace, imageRef, cacheRef, serviceId, deploymentId }) => {
				await ensureBuildConfigMap(coreApi, namespace, serviceId, deploymentId, config.dockerfile);
				// Deterministic Job name -> a create race yields a tolerated 409; swallow it (the next tick converges).
				await createIgnoreConflict(() =>
					batchApi.createNamespacedJob({
						namespace,
						body: buildDockerfileBuildJob({
							deploymentId,
							serviceId,
							imageRef,
							cacheRef,
							configMapName: buildConfigMapName(deploymentId),
							builderImage: env.builderImage,
							insecure: env.registryInsecure,
							serviceAccount: env.builderServiceAccount,
							ttlSeconds: env.buildJobTtlSeconds,
							timeoutSeconds: env.buildTimeoutSeconds,
							memoryRequest: env.buildMemoryRequest,
							memoryLimit: env.buildMemoryLimit,
							pushConfigSecretName: env.registryPushSecretName
						})
					})
				);
			}
		});
	},

	async teardown(ctx: TeardownContext): Promise<void> {
		await teardownRuntime(ctx);
		// Best-effort: reap any in-flight build artifacts for this service that would otherwise linger until their deadline.
		const batchApi = ctx.kc.makeApiClient(BatchV1Api);
		const coreApi = ctx.kc.makeApiClient(CoreV1Api);
		await reapBuildJobs(batchApi, ctx.serviceId);
		// Dockerfile-specific: also reap the Dockerfile-source ConfigMap (public-repo has none).
		const selector = `${BUILDER_LABEL_SELECTOR},${LABEL_SERVICE_ID}=${ctx.serviceId}`;
		await deleteIgnoreMissing(async () => {
			const cms = await coreApi.listNamespacedConfigMap({ namespace: env.podNamespace, labelSelector: selector });
			for (const cm of cms.items) {
				if (cm.metadata?.name)
					await deleteIgnoreMissing(() => coreApi.deleteNamespacedConfigMap({ name: cm.metadata!.name!, namespace: env.podNamespace }));
			}
		});
	}
};
