import type { DockerImageServiceConfig } from '@kubwave/db';
import { resolveDeploymentImageRef } from '../image-ref.js';
import { reconcileRuntime, teardownRuntime } from './runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from './types.js';

// User supplies an already-built image; all infra goes through the shared reconcileRuntime.
export const dockerImageDeployer: Deployer = {
	type: 'docker-image',

	async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
		const config = ctx.deployment.config as DockerImageServiceConfig;
		// Tag-watch snapshots pin the observed digest so the rollout pulls exactly that release, not a tag that moved meanwhile.
		if (config.digest) return reconcileRuntime(ctx, config, `${config.image}@${config.digest}`);

		// Otherwise resolve the tag ourselves: a redeploy of a republished tag would otherwise render an identical pod
		// template, so the Deployment never rolls and the new image is never pulled at all.
		const { ref, pinned } = await resolveDeploymentImageRef({
			deploymentId: ctx.deployment.id,
			recordedRef: ctx.deployment.imageRef,
			image: config.image,
			tag: config.tag,
			registryAuth: config.registryAuth,
			label: 'docker-image'
		});
		// Unpinned means the registry did not answer; unlike a database, a stateless service prefers a re-pull attempt
		// over booting whatever the node cached - that stale layer is the bug this path exists to prevent.
		return reconcileRuntime(ctx, config, ref, { mutableTag: !pinned });
	},

	async teardown(ctx: TeardownContext): Promise<void> {
		await teardownRuntime(ctx);
	}
};
