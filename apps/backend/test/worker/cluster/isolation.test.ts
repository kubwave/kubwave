import { describe, expect, test } from 'bun:test';
import { buildTenantIsolation } from '~/shared/cluster/isolation';

// The env shape buildTenantIsolation consumes — only the tenant* knobs matter.
function tenantEnv(overrides: Partial<Parameters<typeof buildTenantIsolation>[0]> = {}) {
	return {
		tenantPodSecurity: 'baseline',
		tenantRuntimeClass: '',
		tenantEgressEnabled: false,
		tenantEgressBlockedCidrs: ['10.0.0.0/8', '169.254.0.0/16'],
		dnsNamespace: 'kube-system',
		dnsPodLabels: {},
		dnsServiceIp: undefined,
		...overrides
	} as Parameters<typeof buildTenantIsolation>[0];
}

describe('buildTenantIsolation', () => {
	test('passes the Pod Security level through and disables egress by default', () => {
		expect(buildTenantIsolation(tenantEnv())).toEqual({ podSecurityEnforce: 'baseline', runtimeClass: '', egress: null });
	});

	test('builds the egress config when enabled', () => {
		const cfg = buildTenantIsolation(tenantEnv({ tenantEgressEnabled: true }));
		expect(cfg.egress).toEqual({
			blockedCidrs: ['10.0.0.0/8', '169.254.0.0/16'],
			dnsNamespace: 'kube-system',
			dnsPodLabels: { 'k8s-app': 'kube-dns' },
			dnsServiceIp: undefined
		});
	});

	test('passes DNS label and service IP overrides through', () => {
		const cfg = buildTenantIsolation(
			tenantEnv({
				tenantEgressEnabled: true,
				dnsPodLabels: { 'k8s-app': 'coredns' },
				dnsServiceIp: '10.96.0.10/32'
			})
		);
		expect(cfg.egress).toMatchObject({
			dnsPodLabels: { 'k8s-app': 'coredns' },
			dnsServiceIp: '10.96.0.10/32'
		});
	});

	test('passes an empty Pod Security level through (disabled)', () => {
		expect(buildTenantIsolation(tenantEnv({ tenantPodSecurity: '' })).podSecurityEnforce).toBe('');
	});

	test('carries the runtime class through', () => {
		expect(buildTenantIsolation(tenantEnv({ tenantRuntimeClass: 'gvisor' })).runtimeClass).toBe('gvisor');
	});
});
