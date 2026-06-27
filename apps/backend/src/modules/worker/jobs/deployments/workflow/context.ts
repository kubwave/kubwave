import type { KubeConfig } from '@kubernetes/client-node';
import type { Deployment } from '@kubwave/db';

export interface DeploymentReconcileContext {
	kc: KubeConfig;
	deployment: Deployment;
	environmentId: string;
	defaultDomainHost: string | null;
}
