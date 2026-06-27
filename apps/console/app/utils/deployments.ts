import type { Deployment } from '~/utils/types';

type DeploymentStatusColor = 'success' | 'error' | 'neutral';

const STATUS_COLOR: Record<string, DeploymentStatusColor> = {
	succeeded: 'success',
	failed: 'error',
	deploying: 'neutral',
	canceling: 'neutral',
	pending: 'neutral',
	superseded: 'neutral',
	canceled: 'neutral'
};

export function deploymentStatusColor(status: string): DeploymentStatusColor {
	return STATUS_COLOR[status] ?? 'neutral';
}

export function canCancelDeployment(deployment: Deployment | null | undefined): boolean {
	return deployment?.status === 'pending' || deployment?.status === 'deploying';
}

export function shouldPollDeploymentLogs(deployment: Deployment | null | undefined): boolean {
	return deployment?.status === 'pending' || deployment?.status === 'deploying' || deployment?.status === 'canceling';
}

export function hasBuildStep(deployment: Deployment | null | undefined): boolean {
	return deployment?.type === 'dockerfile' || deployment?.type === 'public-repo' || deployment?.type === 'private-repo';
}

export function isDeploymentBuilding(deployment: Deployment): boolean {
	return deployment.phase === 'building' || deployment.phase === 'pushing';
}
