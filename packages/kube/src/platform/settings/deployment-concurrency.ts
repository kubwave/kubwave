export const DEPLOYMENT_CONCURRENCY_SETTINGS_KEY = 'deployment-concurrency';
export const DEFAULT_MAX_CONCURRENT_DEPLOYMENTS = 3;

export interface DeploymentConcurrencySettings {
	maxConcurrentDeployments: number;
}

export function resolveDeploymentConcurrencySettings(value: unknown): DeploymentConcurrencySettings {
	const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<DeploymentConcurrencySettings>) : {};
	const raw = v.maxConcurrentDeployments;
	const valid = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1;
	return { maxConcurrentDeployments: valid ? raw : DEFAULT_MAX_CONCURRENT_DEPLOYMENTS };
}
