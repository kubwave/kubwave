import { BatchV1Api } from '@kubernetes/client-node';
import type { PublicRepoServiceConfig } from '@kubwave/db';
import { env } from '../../../../../../shared/config/worker-env.js';
import { createIgnoreConflict } from '../../../../../../shared/cluster/ops.js';
import { teardownRuntime } from '../runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from '../types.js';
import { reapBuildJobs, runBuildReconcile } from '../../builds/service.js';
import { buildJobName, buildSourceJob, sourceBuildContainers } from './job.js';

// Builds a workload from a public Git repo via the shared build->deploy state machine; the Job clones then runs Nixpacks or the repo's own Dockerfile.

export const publicRepoDeployer: Deployer = {
	type: 'public-repo',

	async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
		const config = ctx.deployment.config as PublicRepoServiceConfig;
		const dockerfileMode = config.builder === 'dockerfile';
		return runBuildReconcile(ctx, config, {
			jobName: buildJobName(ctx.deployment.id),
			// Mode-specific so the failure-log scrape targets the container that actually ran.
			buildContainers: sourceBuildContainers(config.builder),
			startMessage: dockerfileMode ? 'Cloning repository and building its Dockerfile' : 'Cloning repository and building with Nixpacks',
			notConfiguredError: 'Public-repo builds are not available: no build registry is configured (REGISTRY_ENDPOINT).',
			startBuild: async ({ batchApi, namespace, imageRef, cacheRef, serviceId, deploymentId }) => {
				const buildToolsImage = env.buildToolsImage;
				if (!buildToolsImage) throw new Error('Source builds are not available: no build tools image is configured (BUILD_TOOLS_IMAGE).');
				// Deterministic Job name -> a create race yields a tolerated 409; swallow it (the next tick reads the Job and converges).
				await createIgnoreConflict(() =>
					batchApi.createNamespacedJob({
						namespace,
						body: buildSourceJob({
							deploymentId,
							serviceId,
							imageRef,
							cacheRef,
							repoUrl: config.repoUrl,
							branch: config.branch,
							commit: config.commit,
							rootDirectory: config.rootDirectory,
							buildCommand: config.buildCommand,
							startCommand: config.startCommand,
							builder: config.builder,
							dockerfilePath: config.dockerfilePath,
							// Plaintext env is exposed to the build; secrets stay runtime-only (never in image layers).
							buildEnv: config.env,
							buildToolsImage,
							builderImage: env.builderImage,
							imagePullSecrets: env.buildImagePullSecrets,
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
		// Best-effort reap of any in-flight build Job for this service (no ConfigMap - source comes from git).
		await reapBuildJobs(ctx.kc.makeApiClient(BatchV1Api), ctx.serviceId);
	}
};
