import type { KubeConfig } from '@kubernetes/client-node';
import type { Deployment, DeploymentLogEntry, ServiceType } from '@kubwave/db';
import type { IngressOptions } from '../../../../../shared/cluster/networking.js';

export interface DeployContext {
	kc: KubeConfig;
	// Environment namespace (kubwave-env-<environmentId>), ensured by the reconcile loop before the deployer runs.
	namespace: string;
	// Owning environment id; namespace derives from it and the Dockerfile deployer scopes its image repo (env-<id>/svc-<id>).
	environmentId: string;
	deployment: Deployment;
	ingress: IngressOptions;
	// Auto-generated default host (instance setting), or null when off. Paired with the config's HTTP port into a ServiceDomain.
	defaultDomainHost: string | null;
	// Rollback mode reuses an already-built artifact and must never start a build.
	buildMode?: 'normal' | 'rollback';
}

export interface TeardownContext {
	kc: KubeConfig;
	namespace: string;
	serviceId: string;
}

// Outcome of one reconcile pass (`failed` is terminal); `events` are actions actually performed this pass, appended to the step-log verbatim.
export type ReconcileResult = ({ state: 'ready' } | { state: 'progressing'; phase: string } | { state: 'failed'; error: string }) & {
	events?: DeploymentLogEntry[];
};

// Turns one service type's config snapshot into cluster resources. `reconcile` must be idempotent (called every tick until terminal).
export interface Deployer {
	type: ServiceType;
	reconcile(ctx: DeployContext): Promise<ReconcileResult>;
	teardown(ctx: TeardownContext): Promise<void>;
}
