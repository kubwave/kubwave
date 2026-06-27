import { env } from '../config/worker-env.js';
import type { TenantIsolationConfig } from './namespaces.js';

// Translates flat worker env knobs into the TenantIsolationConfig the provisioner consumes;
// kept out of namespaces.ts so that module stays env-free and unit-testable.
type TenantEnv = Pick<
	typeof env,
	'tenantPodSecurity' | 'tenantRuntimeClass' | 'tenantEgressEnabled' | 'tenantEgressBlockedCidrs' | 'dnsNamespace' | 'dnsPodLabels' | 'dnsServiceIp'
>;

export function buildTenantIsolation(e: TenantEnv): TenantIsolationConfig {
	return {
		podSecurityEnforce: e.tenantPodSecurity,
		runtimeClass: e.tenantRuntimeClass,
		egress: e.tenantEgressEnabled
			? {
					blockedCidrs: e.tenantEgressBlockedCidrs,
					dnsNamespace: e.dnsNamespace,
					dnsPodLabels: Object.keys(e.dnsPodLabels).length > 0 ? e.dnsPodLabels : { 'k8s-app': 'kube-dns' },
					dnsServiceIp: e.dnsServiceIp
				}
			: null
	};
}

// Computed once at module load; the knobs are static for the worker's lifetime.
export const tenantIsolation = buildTenantIsolation(env);
