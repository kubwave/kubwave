import { and, desc, eq, lt } from 'drizzle-orm';
import { CoreV1Api, NetworkingV1Api, type KubeConfig } from '@kubernetes/client-node';
import { db, deployments, type Deployment, type DeploymentLogEntry } from '@kubwave/db';
import { environmentNamespace } from '@kubwave/kube';
import { env } from '../../../../shared/config/worker-env.js';
import { ensureEnvironmentNamespace } from '../../../../shared/cluster/namespaces.js';
import { tenantIsolation } from '../../../../shared/cluster/isolation.js';
import { getDeployer } from './deployers/registry.js';
import { ingressOptions } from './ingress-options.js';
import { deleteBuildArtifactsForDeployment, hasRunningBuildJobForDeployment } from './builds/service.js';
import { finalize, insertLogs, logEntry, phaseEntry } from './logs.js';

const MAX_CANCEL_ROLLBACK_ATTEMPTS = 3;
const BUILD_SERVICE_TYPES = new Set<Deployment['type']>(['dockerfile', 'public-repo', 'private-repo']);

function isBuildDeployment(row: Deployment): boolean {
	return BUILD_SERVICE_TYPES.has(row.type);
}

async function previousSuccessfulDeployment(row: Deployment): Promise<Deployment | null> {
	const [previous] = await db
		.select()
		.from(deployments)
		.where(and(eq(deployments.serviceId, row.serviceId), eq(deployments.status, 'succeeded'), lt(deployments.createdAt, row.createdAt)))
		.orderBy(desc(deployments.createdAt))
		.limit(1);
	return previous ?? null;
}

async function updateCancelingProgress(row: Deployment, phase: string, events: DeploymentLogEntry[]): Promise<void> {
	const phaseChanged = phase !== row.phase;
	const entries = [...events, ...(phaseChanged ? [phaseEntry(phase)] : [])];
	const updated = await db
		.update(deployments)
		.set({ phase })
		.where(and(eq(deployments.id, row.id), eq(deployments.status, 'canceling')))
		.returning({ id: deployments.id });
	if (updated.length > 0) await insertLogs(row.id, entries);
}

async function recordRollbackFailure(row: Deployment, error: string, events: DeploymentLogEntry[], attempt: number): Promise<void> {
	const phase = 'rollback-retrying';
	const message = `Cancel rollback failed: ${error}`;
	const entries = [
		...events,
		logEntry('warn', 'rollback-retry', `Cancel rollback attempt ${attempt}/${MAX_CANCEL_ROLLBACK_ATTEMPTS} failed: ${error}`),
		...(phase !== row.phase ? [phaseEntry(phase)] : [])
	];
	const updated = await db
		.update(deployments)
		.set({ rollbackAttempts: attempt, phase, lastError: message })
		.where(and(eq(deployments.id, row.id), eq(deployments.status, 'canceling')))
		.returning({ id: deployments.id });
	if (updated.length > 0) await insertLogs(row.id, entries);
}

export async function reconcileCanceling(kc: KubeConfig, row: Deployment, environmentId: string, defaultDomainHost: string | null): Promise<void> {
	if (isBuildDeployment(row) && row.phase === 'building' && (await hasRunningBuildJobForDeployment(kc, row.id))) {
		await deleteBuildArtifactsForDeployment(kc, row.id);
		await finalize(row.id, 'canceling', { status: 'canceled', phase: 'canceled', lastError: null }, [
			logEntry('warn', 'cleanup', 'Canceled build and removed build artifacts'),
			logEntry('warn', 'canceled', 'Deployment canceled')
		]);
		return;
	}

	const previous = await previousSuccessfulDeployment(row);
	const deployer = getDeployer(row.type);

	if (!previous) {
		await deployer.teardown({ kc, namespace: environmentNamespace(environmentId), serviceId: row.serviceId });
		await finalize(row.id, 'canceling', { status: 'canceled', phase: 'canceled', lastError: null }, [
			logEntry('warn', 'cleanup', 'Removed deployment resources because no previous successful deployment exists'),
			logEntry('warn', 'canceled', 'Deployment canceled')
		]);
		return;
	}

	const coreApi = kc.makeApiClient(CoreV1Api);
	const netApi = kc.makeApiClient(NetworkingV1Api);
	const namespace = await ensureEnvironmentNamespace({
		coreApi,
		netApi,
		environmentId,
		ingressControllerNamespace: env.ingressControllerNamespace,
		isolation: tenantIsolation
	});

	const result = await getDeployer(previous.type).reconcile({
		kc,
		namespace,
		environmentId,
		deployment: previous,
		ingress: ingressOptions,
		defaultDomainHost,
		buildMode: 'rollback'
	});
	const events = result.events ?? [];
	if (result.state === 'ready') {
		await finalize(row.id, 'canceling', { status: 'canceled', phase: 'canceled', lastError: null }, [
			...events,
			logEntry('info', 'restored', `Restored previous successful deployment ${previous.id}`),
			logEntry('warn', 'canceled', 'Deployment canceled')
		]);
	} else if (result.state === 'failed') {
		const attempt = (row.rollbackAttempts ?? 0) + 1;
		const message = `Cancel rollback failed: ${result.error}`;
		if (attempt >= MAX_CANCEL_ROLLBACK_ATTEMPTS) {
			await finalize(row.id, 'canceling', { status: 'failed', phase: 'failed', lastError: message, rollbackAttempts: attempt }, [
				...events,
				logEntry('error', 'failed', message)
			]);
		} else {
			await recordRollbackFailure(row, result.error, events, attempt);
		}
	} else {
		await updateCancelingProgress(row, result.phase, events);
	}
}
