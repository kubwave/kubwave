import type { DockerImageServiceConfig } from '@kubwave/db';
import { reconcileRuntime, teardownRuntime } from './runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from './types.js';

// User supplies an already-built image; all infra goes through the shared reconcileRuntime.
export const dockerImageDeployer: Deployer = {
	type: 'docker-image',

	async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
		const config = ctx.deployment.config as DockerImageServiceConfig;
		return reconcileRuntime(ctx, config, `${config.image}:${config.tag}`);
	},

	async teardown(ctx: TeardownContext): Promise<void> {
		await teardownRuntime(ctx);
	}
};
