import type { DatabaseEngine, DatabaseServiceConfig } from '@kubwave/db';
import { buildDatabaseRuntimeConfig, databaseImageRef } from '@kubwave/db/database-engines';
import { reconcileRuntime, teardownRuntime } from './runtime/runtime.service.js';
import type { Deployer, DeployContext, ReconcileResult, TeardownContext } from './types.js';

// Managed single-instance database (postgres/mysql/mariadb/mongodb): no build step (public engine image); runtime config
// (env, password secrets, data volume, TCP probe) is synthesized from the engine catalog, then handed to reconcileRuntime.
function makeDatabaseDeployer(engine: DatabaseEngine): Deployer {
	return {
		type: engine,

		async reconcile(ctx: DeployContext): Promise<ReconcileResult> {
			const config = ctx.deployment.config as DatabaseServiceConfig;
			// The catalog selects a major line (`postgres:16`), which upstream republishes on every patch release, so the
			// node's cached copy of that tag goes stale - a restart would otherwise resurrect an unpatched engine forever.
			return reconcileRuntime(ctx, buildDatabaseRuntimeConfig(engine, config), databaseImageRef(engine, config.version), {
				mutableTag: true
			});
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
