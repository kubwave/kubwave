import type { DeploymentStatus, DeploymentTrigger, ServiceType } from '@kubwave/db';
import type { ServiceConfigView } from '../services/services.types.js';

export interface DeploymentView {
	id: string;
	serviceId: string;
	type: ServiceType;
	status: DeploymentStatus;
	phase: string | null;
	lastError: string | null;
	attempts: number;
	config: ServiceConfigView;
	trigger: DeploymentTrigger;
	triggeredByUserId: string | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}
