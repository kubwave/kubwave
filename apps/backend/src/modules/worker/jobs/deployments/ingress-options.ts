import { env } from '../../../../shared/config/worker-env.js';

// Cluster-specific Ingress wiring for every tenant domain (Helm-configurable). Process-static, read
// once from env; shared by reconcile (reconcileOne) and cancel (reconcileCanceling).
export const ingressOptions = {
	className: env.ingressClassName,
	clusterIssuer: env.ingressClusterIssuer,
	annotations: env.ingressAnnotations
};
