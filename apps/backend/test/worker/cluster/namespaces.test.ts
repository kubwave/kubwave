import { describe, expect, test } from 'bun:test';
import type { CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';

// Nothing mocked (pure kube helpers + real ./ops); fake Core/Networking APIs drive the namespace converge and the isolation policy.
import { ensureEnvironmentNamespace, type TenantIsolationConfig } from '~/shared/cluster/namespaces';

const notFound = { code: 404 };
const conflict = { code: 409 };

const PSS_ENFORCE = 'pod-security.kubernetes.io/enforce';

const noHardening: TenantIsolationConfig = { podSecurityEnforce: '', runtimeClass: '', egress: null };
const baseline: TenantIsolationConfig = { podSecurityEnforce: 'baseline', runtimeClass: '', egress: null };
const withEgress: TenantIsolationConfig = {
	podSecurityEnforce: 'baseline',
	runtimeClass: '',
	egress: {
		blockedCidrs: ['10.0.0.0/8', '169.254.0.0/16'],
		dnsNamespace: 'kube-system',
		dnsPodLabels: { 'k8s-app': 'coredns' },
		dnsServiceIp: '10.96.0.10/32'
	}
};

interface State {
	namespace?: unknown;
	policy?: unknown;
	nsCreateThrows?: unknown;
	policyCreateThrows?: unknown;
}

function setup(state: State) {
	const calls = { createNs: 0, replaceNs: 0, createPolicy: 0, replacePolicy: 0 };
	const bodies: Record<string, unknown> = {};
	const give = (v: unknown) => {
		if (v === undefined) throw notFound;
		return v;
	};

	const coreApi = {
		readNamespace: async () => give(state.namespace),
		createNamespace: async ({ body }: { body: unknown }) => {
			calls.createNs++;
			bodies.namespace = body;
			if (state.nsCreateThrows) throw state.nsCreateThrows;
		},
		replaceNamespace: async ({ body }: { body: unknown }) => {
			calls.replaceNs++;
			bodies.namespaceReplace = body;
		}
	} as unknown as CoreV1Api;

	const netApi = {
		readNamespacedNetworkPolicy: async () => give(state.policy),
		createNamespacedNetworkPolicy: async ({ body }: { body: unknown }) => {
			calls.createPolicy++;
			bodies.policy = body;
			if (state.policyCreateThrows) throw state.policyCreateThrows;
		},
		replaceNamespacedNetworkPolicy: async ({ body }: { body: unknown }) => {
			calls.replacePolicy++;
			bodies.policyReplace = body;
		}
	} as unknown as NetworkingV1Api;

	return { coreApi, netApi, calls, bodies };
}

function run(s: ReturnType<typeof setup>, isolation: TenantIsolationConfig, environmentId = 'env-7', ingressControllerNamespace = 'kube-system') {
	return ensureEnvironmentNamespace({ coreApi: s.coreApi, netApi: s.netApi, environmentId, ingressControllerNamespace, isolation });
}

describe('ensureEnvironmentNamespace', () => {
	test('returns the per-environment namespace name', async () => {
		const s = setup({
			namespace: { metadata: { name: 'ns', labels: { [PSS_ENFORCE]: 'baseline' } } },
			policy: { spec: { policyTypes: ['Ingress'] } }
		});
		expect(await run(s, baseline)).toBe('kubwave-env-env-7');
	});

	test('creates nothing when namespace + policy exist and the PSS label already matches', async () => {
		const s = setup({
			namespace: { metadata: { name: 'ns', labels: { [PSS_ENFORCE]: 'baseline' } } },
			policy: { spec: { policyTypes: ['Ingress'] } }
		});
		await run(s, baseline);
		expect(s.calls).toEqual({ createNs: 0, replaceNs: 0, createPolicy: 0, replacePolicy: 0 });
	});

	test('lazily creates the namespace (with Pod Security + managed labels) and the ingress-only policy', async () => {
		const s = setup({});
		await run(s, baseline, 'env-7', 'ingress-ns');
		expect(s.calls).toMatchObject({ createNs: 1, createPolicy: 1 });

		expect(s.bodies.namespace).toMatchObject({
			metadata: {
				name: 'kubwave-env-env-7',
				labels: {
					'app.kubernetes.io/managed-by': 'kubwave-worker',
					'kubwave/environment-id': 'env-7',
					'pod-security.kubernetes.io/enforce': 'baseline',
					'pod-security.kubernetes.io/enforce-version': 'latest'
				}
			}
		});

		const policy = s.bodies.policy as { spec: { policyTypes: string[]; ingress: Array<{ _from: unknown[] }>; egress?: unknown } };
		expect(policy.spec.policyTypes).toEqual(['Ingress']);
		expect(policy.spec.egress).toBeUndefined();
		expect(policy.spec.ingress[0]!._from).toEqual([
			{ podSelector: {} },
			{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'ingress-ns' } } }
		]);
	});

	test('omits the Pod Security labels when podSecurityEnforce is empty', async () => {
		const s = setup({});
		await run(s, noHardening);
		expect((s.bodies.namespace as { metadata: { labels: Record<string, string> } }).metadata.labels).toEqual({
			'app.kubernetes.io/managed-by': 'kubwave-worker',
			'kubwave/environment-id': 'env-7'
		});
	});

	test('builds an ingress+egress policy when egress isolation is on', async () => {
		const s = setup({});
		await run(s, withEgress);

		const policy = s.bodies.policy as { spec: { policyTypes: string[]; egress: Array<{ to: Array<Record<string, unknown>>; ports?: unknown[] }> } };
		expect(policy.spec.policyTypes).toEqual(['Ingress', 'Egress']);
		// same-namespace, DNS, then public-internet (0.0.0.0/0 minus the blocked ranges).
		expect(policy.spec.egress).toHaveLength(3);
		expect(policy.spec.egress[0]!.to).toEqual([{ podSelector: {} }]);
		expect(policy.spec.egress[1]!.to).toEqual([
			{
				namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
				podSelector: { matchLabels: { 'k8s-app': 'coredns' } }
			},
			{ ipBlock: { cidr: '10.96.0.10/32' } }
		]);
		expect(policy.spec.egress[2]!.to[0]).toEqual({ ipBlock: { cidr: '0.0.0.0/0', except: ['10.0.0.0/8', '169.254.0.0/16'] } });
	});

	test('replaces an existing namespace that is missing the Pod Security label (converge on upgrade)', async () => {
		const s = setup({ namespace: { metadata: { name: 'ns', labels: { foo: 'bar' } } }, policy: { spec: { policyTypes: ['Ingress'] } } });
		await run(s, baseline);
		expect(s.calls.replaceNs).toBe(1);
		expect((s.bodies.namespaceReplace as { metadata: { labels: Record<string, string> } }).metadata.labels).toMatchObject({
			foo: 'bar',
			'pod-security.kubernetes.io/enforce': 'baseline'
		});
	});

	test('strips stale Pod Security labels from an existing namespace when switching to off', async () => {
		const s = setup({
			namespace: {
				metadata: {
					name: 'ns',
					labels: {
						foo: 'bar',
						'pod-security.kubernetes.io/enforce': 'baseline',
						'pod-security.kubernetes.io/enforce-version': 'latest',
						'pod-security.kubernetes.io/warn': 'baseline',
						'pod-security.kubernetes.io/warn-version': 'latest'
					}
				}
			},
			policy: { spec: { policyTypes: ['Ingress'] } }
		});
		await run(s, noHardening);
		expect(s.calls.replaceNs).toBe(1);
		// Operator label survives; every PSS label is removed (a plain merge would leave them stuck).
		expect((s.bodies.namespaceReplace as { metadata: { labels: Record<string, string> } }).metadata.labels).toEqual({
			foo: 'bar',
			'app.kubernetes.io/managed-by': 'kubwave-worker',
			'kubwave/environment-id': 'env-7'
		});
	});

	test('replaces an existing ingress-only policy when egress isolation is turned on (converge)', async () => {
		const s = setup({ namespace: { metadata: { labels: { [PSS_ENFORCE]: 'baseline' } } }, policy: { spec: { policyTypes: ['Ingress'] } } });
		await run(s, withEgress);
		expect(s.calls.replacePolicy).toBe(1);
		expect((s.bodies.policyReplace as { spec: { policyTypes: string[] } }).spec.policyTypes).toEqual(['Ingress', 'Egress']);
	});

	test('swallows a 409 race on namespace and policy create', async () => {
		const s = setup({ nsCreateThrows: conflict, policyCreateThrows: conflict });
		await expect(run(s, baseline)).resolves.toBe('kubwave-env-env-7');
		expect(s.calls).toMatchObject({ createNs: 1, createPolicy: 1 });
	});
});
