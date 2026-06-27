import { eq } from 'drizzle-orm';
import { BatchV1Api, CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import { db, sshKeys, type PrivateRepoServiceConfig } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { LABEL_SERVICE_ID } from '@kubwave/kube';
import { env } from '../../../../../../shared/config/worker-env.js';
import { createIgnoreConflict, deleteIgnoreMissing } from '../../../../../../shared/cluster/ops.js';
import { teardownRuntime } from '../runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from '../types.js';
import { BUILDER_LABEL_SELECTOR, buildJobLabels, reapBuildJobs, runBuildReconcile } from '../../builds/service.js';
import { buildJobName, buildSourceJob, sourceBuildContainers } from '../public-repo/job.js';
import { ensureSshEgressPolicy, parsePrivateRepoSshPort } from './ssh-egress.js';

// Clone over SSH with a team deploy key, reusing public-repo's job-spec verbatim; only addition is decrypting the SSH key into a one-shot Secret.

const JOB_NAME_PREFIX = 'private-repo-build';

// Per-build Secret carrying the DECRYPTED deploy key, labelled like every build artifact so reaper+teardown bound how long the plaintext key lives in the cluster.
function sshSecretName(deploymentId: string): string {
	return `${JOB_NAME_PREFIX}-${deploymentId}-ssh`;
}

// Decrypt the team key into a one-shot Secret under data key `id`; create unconditionally (409 swallowed). Throws a retryable failure if the key was deleted.
async function ensureSshKeySecret(api: CoreV1Api, namespace: string, serviceId: string, deploymentId: string, sshKeyId: string): Promise<void> {
	const [row] = await db.select({ ciphertext: sshKeys.privateKeyCiphertext }).from(sshKeys).where(eq(sshKeys.id, sshKeyId)).limit(1);
	if (!row) throw new Error('Deploy key not found - it may have been deleted. Reattach a key in the service settings.');

	const privateKey = decryptSecret(row.ciphertext);
	// OpenSSH refuses a key file without a trailing newline; ensure one.
	const keyData = privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`;

	await createIgnoreConflict(() =>
		api.createNamespacedSecret({
			namespace,
			body: {
				apiVersion: 'v1',
				kind: 'Secret',
				metadata: { name: sshSecretName(deploymentId), namespace, labels: buildJobLabels(serviceId, deploymentId) },
				type: 'Opaque',
				stringData: { id: keyData }
			}
		})
	);
}

export const privateRepoDeployer: Deployer = {
	type: 'private-repo',

	async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
		const config = ctx.deployment.config as PrivateRepoServiceConfig;
		const dockerfileMode = config.builder === 'dockerfile';
		let sshPort: number | null = null;
		const resolveSshPort = () => (sshPort ??= parsePrivateRepoSshPort(config.repoUrl));
		return runBuildReconcile(ctx, config, {
			jobName: buildJobName(ctx.deployment.id, JOB_NAME_PREFIX),
			buildContainers: sourceBuildContainers(config.builder),
			startMessage: dockerfileMode
				? 'Cloning private repository and building its Dockerfile'
				: 'Cloning private repository and building with Nixpacks',
			notConfiguredError: 'Private-repo builds are not available: no build registry is configured (REGISTRY_ENDPOINT).',
			validateBuildConfig: () => {
				try {
					resolveSshPort();
					return null;
				} catch (err) {
					return err instanceof Error ? err.message : 'Invalid private repository SSH URL.';
				}
			},
			startBuild: async ({ coreApi, batchApi, namespace, imageRef, cacheRef, serviceId, deploymentId }) => {
				const buildToolsImage = env.buildToolsImage;
				if (!buildToolsImage) throw new Error('Private-repo builds are not available: no build tools image is configured (BUILD_TOOLS_IMAGE).');
				await ensureSshKeySecret(coreApi, namespace, serviceId, deploymentId, config.sshKeyId);
				await ensureSshEgressPolicy({ api: ctx.kc.makeApiClient(NetworkingV1Api), namespace, serviceId, deploymentId, port: resolveSshPort() });
				// Deterministic Job name -> a create race yields a tolerated 409; swallow it (the next tick converges).
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
							pushConfigSecretName: env.registryPushSecretName,
							sshKeySecretName: sshSecretName(deploymentId),
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
		const netApi = ctx.kc.makeApiClient(NetworkingV1Api);
		await reapBuildJobs(batchApi, ctx.serviceId);
		// Private-repo-specific: also reap any deploy-key Secret for this service, catching an in-flight build at delete time.
		const selector = `${BUILDER_LABEL_SELECTOR},${LABEL_SERVICE_ID}=${ctx.serviceId}`;
		await deleteIgnoreMissing(async () => {
			const secrets = await coreApi.listNamespacedSecret({ namespace: env.podNamespace, labelSelector: selector });
			for (const s of secrets.items) {
				if (s.metadata?.name)
					await deleteIgnoreMissing(() => coreApi.deleteNamespacedSecret({ name: s.metadata!.name!, namespace: env.podNamespace }));
			}
		});
		await deleteIgnoreMissing(async () => {
			const policies = await netApi.listNamespacedNetworkPolicy({ namespace: env.podNamespace, labelSelector: selector });
			for (const policy of policies.items) {
				if (policy.metadata?.name)
					await deleteIgnoreMissing(() => netApi.deleteNamespacedNetworkPolicy({ name: policy.metadata!.name!, namespace: env.podNamespace }));
			}
		});
	}
};
