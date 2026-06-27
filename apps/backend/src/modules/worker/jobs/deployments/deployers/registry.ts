import type { ServiceType } from '@kubwave/db';
import { dockerImageDeployer } from './docker-image.js';
import { dockerfileDeployer } from './dockerfile/deployer.js';
import { publicRepoDeployer } from './public-repo/deployer.js';
import { privateRepoDeployer } from './private-repo/deployer.js';
import { mariadbDeployer, mongodbDeployer, mysqlDeployer, postgresDeployer } from './database.js';
export type { DeployContext, TeardownContext, ReconcileResult, Deployer } from './types.js';
import type { Deployer } from './types.js';

// Extension seam: add a new type to `ServiceType` in @kubwave/db and register its Deployer here. The
// `Record<ServiceType, Deployer>` typing makes a missing registration a compile error.
const deployers: Record<ServiceType, Deployer> = {
	'docker-image': dockerImageDeployer,
	dockerfile: dockerfileDeployer,
	'public-repo': publicRepoDeployer,
	'private-repo': privateRepoDeployer,
	postgres: postgresDeployer,
	mysql: mysqlDeployer,
	mariadb: mariadbDeployer,
	mongodb: mongodbDeployer
};

export function getDeployer(type: ServiceType): Deployer {
	return deployers[type];
}
