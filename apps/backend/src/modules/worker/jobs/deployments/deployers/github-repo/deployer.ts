import { BatchV1Api, CoreV1Api } from '@kubernetes/client-node';
import type { GithubRepoServiceConfig } from '@kubwave/db';
import { LABEL_SERVICE_ID } from '@kubwave/kube';
import { env } from '../../../../../../shared/config/worker-env.js';
import { createIgnoreConflict, deleteIgnoreMissing } from '../../../../../../shared/cluster/ops.js';
import { basicAuthHeader, extraHeaderConfigKey } from '../../../../../git/git-clone-auth.js';
import { getInstallationToken } from '../../../../../git/installation-token.js';
import { teardownRuntime } from '../runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from '../types.js';
import { BUILDER_LABEL_SELECTOR, buildJobLabels, reapBuildJobs, runBuildReconcile } from '../../builds/service.js';
import { buildJobName, buildSourceJob, sourceBuildContainers } from '../public-repo/job.js';

const JOB_NAME_PREFIX = 'github-repo-build';

function tokenSecretName(deploymentId: string): string {
	return `${JOB_NAME_PREFIX}-${deploymentId}-token`;
}

// Mint a short-lived installation token and drop it as a one-shot Secret (the Authorization header, not the raw token) labelled like every build artifact so reaper+teardown bound its lifetime.
async function ensureTokenSecret(api: CoreV1Api, namespace: string, serviceId: string, deploymentId: string, installationId: string): Promise<void> {
	const token = await getInstallationToken(installationId);
	await createIgnoreConflict(() =>
		api.createNamespacedSecret({
			namespace,
			body: {
				apiVersion: 'v1',
				kind: 'Secret',
				metadata: { name: tokenSecretName(deploymentId), namespace, labels: buildJobLabels(serviceId, deploymentId) },
				type: 'Opaque',
				stringData: { extraheader: basicAuthHeader(token) }
			}
		})
	);
}

export const githubRepoDeployer: Deployer = {
	type: 'github-repo',

	async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
		const config = ctx.deployment.config as GithubRepoServiceConfig;
		const dockerfileMode = config.builder === 'dockerfile';
		return runBuildReconcile(ctx, config, {
			jobName: buildJobName(ctx.deployment.id, JOB_NAME_PREFIX),
			buildContainers: sourceBuildContainers(config.builder),
			startMessage: dockerfileMode ? 'Cloning GitHub repository and building its Dockerfile' : 'Cloning GitHub repository and building with Nixpacks',
			notConfiguredError: 'GitHub-repo builds are not available: no build registry is configured (REGISTRY_ENDPOINT).',
			startBuild: async ({ coreApi, batchApi, namespace, imageRef, cacheRef, serviceId, deploymentId }) => {
				const buildToolsImage = env.buildToolsImage;
				if (!buildToolsImage) throw new Error('GitHub-repo builds are not available: no build tools image is configured (BUILD_TOOLS_IMAGE).');
				await ensureTokenSecret(coreApi, namespace, serviceId, deploymentId, config.installationId);
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
							pushConfigSecretName: env.registryPushSecretName,
							gitTokenSecretName: tokenSecretName(deploymentId),
							gitTokenConfigKey: extraHeaderConfigKey(config.repoUrl),
							jobNamePrefix: JOB_NAME_PREFIX
						})
					})
				);
			}
		});
	},

	async teardown(ctx: TeardownContext): Promise<void> {
		await teardownRuntime(ctx);
		const batchApi = ctx.kc.makeApiClient(BatchV1Api);
		const coreApi = ctx.kc.makeApiClient(CoreV1Api);
		await reapBuildJobs(batchApi, ctx.serviceId);
		const selector = `${BUILDER_LABEL_SELECTOR},${LABEL_SERVICE_ID}=${ctx.serviceId}`;
		await deleteIgnoreMissing(async () => {
			const secrets = await coreApi.listNamespacedSecret({ namespace: env.podNamespace, labelSelector: selector });
			for (const s of secrets.items) {
				if (s.metadata?.name)
					await deleteIgnoreMissing(() => coreApi.deleteNamespacedSecret({ name: s.metadata!.name!, namespace: env.podNamespace }));
			}
		});
	}
};
