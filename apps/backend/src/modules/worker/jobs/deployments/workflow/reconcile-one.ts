import { and, eq, inArray } from 'drizzle-orm';
import { CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import { db, deployments, type Deployment } from '@kubwave/db';
import { ensureEnvironmentNamespace } from '../../../../../shared/cluster/namespaces.js';
import { tenantIsolation } from '../../../../../shared/cluster/isolation.js';
import { env } from '../../../../../shared/config/worker-env.js';
import { reconcileCanceling } from '../cancel.js';
import { getDeployer } from '../deployers/registry.js';
import { RECONCILE_IN_FLIGHT_STATUSES } from '../types.js';
import { ingressOptions } from '../ingress-options.js';
import type { DeploymentReconcileContext } from './context.js';
import { handleReconcileError } from './errors.js';
import { applyReconcileResult } from './outcomes.js';

async function reassertDeploymentLease(deployment: Deployment): Promise<void> {
	// (Re)assert the lease so a long rollout stays owned by us; writes NO logs. Status guard skips rows that went terminal since selection.
	await db
		.update(deployments)
		.set({ lockedBy: env.workerId, lockedAt: new Date() })
		.where(and(eq(deployments.id, deployment.id), inArray(deployments.status, [...RECONCILE_IN_FLIGHT_STATUSES])));
}

async function ensureDeploymentNamespace(ctx: DeploymentReconcileContext): Promise<string> {
	const coreApi = ctx.kc.makeApiClient(CoreV1Api);
	const netApi = ctx.kc.makeApiClient(NetworkingV1Api);
	return ensureEnvironmentNamespace({
		coreApi,
		netApi,
		environmentId: ctx.environmentId,
		ingressControllerNamespace: env.ingressControllerNamespace,
		isolation: tenantIsolation
	});
}

export async function reconcileOne(ctx: DeploymentReconcileContext): Promise<void> {
	const { deployment } = ctx;
	await reassertDeploymentLease(deployment);

	try {
		if (deployment.status === 'canceling') {
			await reconcileCanceling(ctx.kc, deployment, ctx.environmentId, ctx.defaultDomainHost);
			return;
		}

		// Lazily ensure the environment's namespace (+ isolation NetworkPolicy) before first rollout; inside the try so a transient failure retries.
		const namespace = await ensureDeploymentNamespace(ctx);
		const result = await getDeployer(deployment.type).reconcile({
			kc: ctx.kc,
			namespace,
			environmentId: ctx.environmentId,
			deployment,
			ingress: ingressOptions,
			defaultDomainHost: ctx.defaultDomainHost
		});

		await applyReconcileResult(deployment, result);
	} catch (err) {
		await handleReconcileError(deployment, err);
	}
}
