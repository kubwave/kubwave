import { describe, expect, mock, test } from 'bun:test';
import type { CoreV1Api } from '@kubernetes/client-node';

// Mock the IO seams. NOTE: the SUT carries module-level state (lastWritten + IP cache); tests are ordered around it.

let envOverride: Record<string, unknown> = {};
const setCalls: Array<{ key: string; value: unknown }> = [];
let settingRow: unknown = null;
let setSettingThrows: unknown = null;

mock.module('~/shared/config/worker-env', () => ({
	env: {
		ingressControllerService: 'traefik',
		ingressControllerNamespace: 'kube-system',
		// undefined unless a test overrides — toggled via envOverride getters below.
		get ingressLoadBalancerIp() {
			return envOverride.ingressLoadBalancerIp;
		},
		get ingressClusterIssuer() {
			return envOverride.ingressClusterIssuer;
		}
	}
}));

mock.module('~/shared/worker-common/settings', () => ({
	setSetting: async (key: string, value: unknown) => {
		setCalls.push({ key, value });
		if (setSettingThrows) throw setSettingThrows;
	},
	getSetting: async () => settingRow
}));

mock.module('@kubwave/db', () => ({
	DEFAULT_DOMAIN_RUNTIME_KEY: 'default-domain-runtime',
	DEFAULT_DOMAIN_SETTINGS_KEY: 'default-domain',
	// Faithful stand-in: merge stored over the sslip defaults the real helper applies.
	resolveDefaultDomainSettings: (stored: Record<string, unknown> | null | undefined) => ({
		mode: stored?.mode ?? 'sslip',
		base: stored?.base ?? null,
		subdomainTemplate: stored?.subdomainTemplate ?? null
	}),
	resolveDefaultDomainRuntime: (stored: Record<string, unknown> | null | undefined) => ({
		ingressIp: stored?.ingressIp ?? null,
		tls: stored?.tls ?? false
	})
}));

const { reconcileDefaultDomainRuntime, getDefaultDomainSettings, getDefaultDomainRuntime } = await import('~/shared/cluster/default-domain');

function svcWithIngress(ingress: { ip?: string; hostname?: string } | undefined): CoreV1Api {
	return {
		readNamespacedService: async () => ({ status: { loadBalancer: { ingress: ingress ? [ingress] : [] } } })
	} as unknown as CoreV1Api;
}

describe('reconcileDefaultDomainRuntime', () => {
	test('prefers the configured LB IP over reading the cluster, sets tls from the cluster issuer', async () => {
		envOverride = { ingressLoadBalancerIp: '10.0.0.5', ingressClusterIssuer: 'letsencrypt' };
		setCalls.length = 0;
		const core = {
			readNamespacedService: async () => {
				throw new Error('should not read the service when LB IP is configured');
			}
		} as unknown as CoreV1Api;

		const runtime = await reconcileDefaultDomainRuntime(core);
		expect(runtime).toEqual({ ingressIp: '10.0.0.5', tls: true });
		expect(setCalls).toEqual([{ key: 'default-domain-runtime', value: { ingressIp: '10.0.0.5', tls: true } }]);
	});

	test('does not re-write the row when the serialized runtime is unchanged', async () => {
		// Same env as the previous test → lastWritten already matches → no write.
		envOverride = { ingressLoadBalancerIp: '10.0.0.5', ingressClusterIssuer: 'letsencrypt' };
		setCalls.length = 0;
		const core = svcWithIngress(undefined);
		const runtime = await reconcileDefaultDomainRuntime(core);
		expect(runtime).toEqual({ ingressIp: '10.0.0.5', tls: true });
		expect(setCalls).toEqual([]);
	});

	test('resolves the IP from the ingress controller Service status (ip then hostname) and tls=false without an issuer', async () => {
		envOverride = { ingressLoadBalancerIp: undefined, ingressClusterIssuer: undefined };
		setCalls.length = 0;
		const runtime = await reconcileDefaultDomainRuntime(svcWithIngress({ ip: '203.0.113.9' }));
		expect(runtime).toEqual({ ingressIp: '203.0.113.9', tls: false });
		expect(setCalls).toEqual([{ key: 'default-domain-runtime', value: { ingressIp: '203.0.113.9', tls: false } }]);
	});

	test('swallows a setSetting failure (non-fatal) and still returns the resolved runtime', async () => {
		// Change the resolved value so it differs from lastWritten and a write is attempted.
		envOverride = { ingressLoadBalancerIp: '198.51.100.2', ingressClusterIssuer: undefined };
		setCalls.length = 0;
		setSettingThrows = new Error('db down');
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
		try {
			const runtime = await reconcileDefaultDomainRuntime(svcWithIngress(undefined));
			expect(runtime).toEqual({ ingressIp: '198.51.100.2', tls: false });
		} finally {
			console.warn = originalWarn;
			setSettingThrows = null;
		}
		expect(setCalls.length).toBe(1);
		expect(warnings.some(w => w.includes('default-domain runtime'))).toBe(true);
	});
});

describe('getDefaultDomainSettings', () => {
	test('returns stored settings merged over defaults', async () => {
		settingRow = { mode: 'wildcard', base: 'apps.example.com' };
		expect(await getDefaultDomainSettings()).toEqual({ mode: 'wildcard', base: 'apps.example.com', subdomainTemplate: null });
	});

	test('falls back to the sslip defaults when no row exists', async () => {
		settingRow = null;
		expect(await getDefaultDomainSettings()).toEqual({ mode: 'sslip', base: null, subdomainTemplate: null });
	});
});

describe('getDefaultDomainRuntime', () => {
	test('returns stored runtime merged over defaults', async () => {
		settingRow = { ingressIp: '203.0.113.10', tls: true };
		expect(await getDefaultDomainRuntime()).toEqual({ ingressIp: '203.0.113.10', tls: true });
	});

	test('falls back to runtime defaults when no row exists', async () => {
		settingRow = null;
		expect(await getDefaultDomainRuntime()).toEqual({ ingressIp: null, tls: false });
	});
});
