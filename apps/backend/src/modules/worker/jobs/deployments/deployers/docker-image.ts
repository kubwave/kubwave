import type { DockerImageServiceConfig } from '@kubwave/db';
import { reconcileRuntime, teardownRuntime } from './runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from './types.js';

// User supplies an already-built image; all infra goes through the shared reconcileRuntime.
export const dockerImageDeployer: Deployer = {
	type: 'docker-image',

	async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
		const config = ctx.deployment.config as DockerImageServiceConfig;
		// Tag-watch snapshots pin the observed digest so the rollout pulls exactly that release, not a tag that moved meanwhile.
		const imageRef = config.digest ? `${config.image}@${config.digest}` : `${config.image}:${config.tag}`;
		return reconcileRuntime(ctx, config, imageRef);
	},

	async teardown(ctx: TeardownContext): Promise<void> {
		await teardownRuntime(ctx);
	}
};
