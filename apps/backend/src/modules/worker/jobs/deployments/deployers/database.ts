import type { DatabaseEngine, DatabaseServiceConfig } from '@kubwave/db';
import { buildDatabaseRuntimeConfig, databaseImageRef, DATABASE_ENGINE_CATALOG } from '@kubwave/db/database-engines';
import { errorMessage } from '../../../../../shared/worker-common/errors.js';
import { persistDeploymentImageRef } from '../image-ref.js';
import { parseImageRef, resolveTagDigest } from '../../registry-tag-watch/registry.js';
import { reconcileRuntime, teardownRuntime } from './runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from './types.js';

// reconcileInFlight walks its rows sequentially, so a blackholed registry here delays every other in-flight deployment.
const DIGEST_RESOLVE_TIMEOUT_MS = 2000;

// The catalog selects a major line (`postgres:16`), which upstream republishes on every patch release. Resolve it to a
// digest so the node's cache is right by construction - `Always` would instead tie every pod start to Docker Hub.
// A tag fallback is retried on later ticks, so it only sticks if the registry is still down when the rollout finishes.
async function resolveEngineImageRef(ctx: DeployContext, engine: DatabaseEngine, version: string): Promise<string> {
	// Recorded on the first tick, so the reconcile loop resolves once per deployment rather than on every pass.
	const stored = ctx.deployment.imageRef?.trim();
	if (stored) return stored;

	const image = DATABASE_ENGINE_CATALOG[engine].image;
	let digest: string | null = null;
	try {
		digest = await resolveTagDigest(parseImageRef(image, version), undefined, DIGEST_RESOLVE_TIMEOUT_MS);
	} catch (err) {
		// An unreachable registry must not fail the deploy: the plain tag under IfNotPresent still boots from cache.
		console.warn(`[deploy] ${engine}: deploying ${version} unpinned, digest resolution failed:`, errorMessage(err));
	}
	// Left unrecorded so the retry below stays open; a write failure is a control-plane fault and belongs to the caller.
	if (!digest) return databaseImageRef(engine, version);

	const pinned = `${image}@${digest}`;
	await persistDeploymentImageRef(ctx.deployment.id, pinned);
	return pinned;
}

// Managed single-instance database (postgres/mysql/mariadb/mongodb): no build step (public engine image); runtime config
// (env, password secrets, data volume, TCP probe) is synthesized from the engine catalog, then handed to reconcileRuntime.
function makeDatabaseDeployer(engine: DatabaseEngine): Deployer {
	return {
		type: engine,

		async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
			const config = ctx.deployment.config as DatabaseServiceConfig;
			const imageRef = await resolveEngineImageRef(ctx, engine, config.version);
			return reconcileRuntime(ctx, buildDatabaseRuntimeConfig(engine, config), imageRef);
		},

		async teardown(ctx: TeardownContext): Promise<void> {
			// Shared teardown deletes the PVC too: deleting the service deletes its data ("keep data on delete" is future work).
			await teardownRuntime(ctx);
		}
	};
}

export const postgresDeployer = makeDatabaseDeployer('postgres');
export const mysqlDeployer = makeDatabaseDeployer('mysql');
export const mariadbDeployer = makeDatabaseDeployer('mariadb');
export const mongodbDeployer = makeDatabaseDeployer('mongodb');
