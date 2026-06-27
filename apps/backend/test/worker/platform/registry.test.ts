import { describe, expect, mock, test } from 'bun:test';
import type { V1NetworkPolicyEgressRule } from '@kubernetes/client-node';

const INGRESS_CONTROLLER_NAMESPACE = 'test-ingress';

mock.module('@kubwave/db', () => ({
	db: {},
	settings: {}
}));

mock.module('~/shared/config/worker-env', () => ({
	env: { ingressControllerNamespace: INGRESS_CONTROLLER_NAMESPACE }
}));

const { registryDrift, registryCredentialHash, registryEnvMatches, registryAwareBuilderNetworkPolicy } =
	await import('~/modules/worker/jobs/platform/registry');

describe('registryDrift', () => {
	test('unconfigured desired state only drifts when a registry was already mirrored', () => {
		expect(registryDrift({ mode: 'unconfigured' }, null)).toBe(false);
		expect(registryDrift({ mode: 'unconfigured' }, { currentVersion: '1.0.0', registryMode: 'unconfigured' })).toBe(false);
		expect(registryDrift({ mode: 'unconfigured' }, { currentVersion: '1.0.0', registryMode: 'platform' })).toBe(true);
	});

	test('platform registry is converged only when marker mode, host, and ingress match', () => {
		const desired = { mode: 'platform' } as const;
		expect(
			registryDrift(desired, {
				currentVersion: '1.0.0',
				domain: 'app.example.com',
				registryMode: 'platform',
				registryHost: 'registry.app.example.com',
				registryIngressEnabled: true
			})
		).toBe(false);
		expect(
			registryDrift(desired, {
				currentVersion: '1.0.0',
				domain: 'app.example.com',
				registryMode: 'platform',
				registryHost: 'old.example.com',
				registryIngressEnabled: true
			})
		).toBe(true);
	});

	test('external registry compares endpoint and insecure trust flag', () => {
		const desired = {
			mode: 'external',
			endpoint: 'registry.example.com/team',
			insecure: true,
			username: 'robot',
			passwordCiphertext: 'v1:x:y:z'
		} as const;
		expect(
			registryDrift(desired, {
				currentVersion: '1.0.0',
				registryMode: 'external',
				registryHost: 'registry.example.com/team',
				registryInsecure: true,
				registryCredentialHash: registryCredentialHash(desired)
			})
		).toBe(false);
		expect(
			registryDrift(desired, {
				currentVersion: '1.0.0',
				registryMode: 'external',
				registryHost: 'registry.example.com/team',
				registryInsecure: false,
				registryCredentialHash: registryCredentialHash(desired)
			})
		).toBe(true);
		expect(
			registryDrift(desired, {
				currentVersion: '1.0.0',
				registryMode: 'external',
				registryHost: 'registry.example.com/team',
				registryInsecure: true,
				registryCredentialHash: registryCredentialHash({ ...desired, passwordCiphertext: 'v1:rotated' })
			})
		).toBe(true);
	});
});

describe('registryEnvMatches', () => {
	const effective = {
		mode: 'external',
		endpoint: 'registry.example.com/team',
		host: 'registry.example.com',
		insecure: false,
		pushSecretName: 'registry-creds',
		pullSecretName: 'kubwave-registry-pull',
		ingressEnabled: false
	} as const;

	test('detects stale worker registry env even when secrets are already configured', () => {
		expect(
			registryEnvMatches(
				[
					{ name: 'REGISTRY_ENDPOINT', value: 'host.k3d.internal:5111' },
					{ name: 'REGISTRY_INSECURE', value: 'true' },
					{ name: 'REGISTRY_PUSH_SECRET_NAME', value: 'registry-creds' },
					{ name: 'REGISTRY_PULL_SECRET_NAME', value: 'kubwave-registry-pull' }
				],
				effective
			)
		).toBe(false);
	});

	test('matches the desired configured and unconfigured worker env', () => {
		expect(
			registryEnvMatches(
				[
					{ name: 'REGISTRY_ENDPOINT', value: 'registry.example.com/team' },
					{ name: 'REGISTRY_INSECURE', value: 'false' },
					{ name: 'REGISTRY_PUSH_SECRET_NAME', value: 'registry-creds' },
					{ name: 'REGISTRY_PULL_SECRET_NAME', value: 'kubwave-registry-pull' }
				],
				effective
			)
		).toBe(true);
		expect(registryEnvMatches([], null)).toBe(true);
		expect(registryEnvMatches([{ name: 'REGISTRY_ENDPOINT', value: 'registry.example.com/team' }], null)).toBe(false);
	});
});

describe('registryAwareBuilderNetworkPolicy', () => {
	const basePolicy = () => ({
		apiVersion: 'networking.k8s.io/v1',
		kind: 'NetworkPolicy',
		metadata: {
			name: 'kubwave-builder-egress',
			namespace: 'kubwave',
			annotations: { 'meta.helm.sh/release-name': 'kubwave' } as Record<string, string>
		},
		spec: {
			podSelector: { matchLabels: { 'app.kubernetes.io/component': 'builder' } },
			policyTypes: ['Ingress', 'Egress'],
			egress: [
				{
					to: [
						{
							namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'custom-dns' } },
							podSelector: { matchLabels: { 'k8s-app': 'custom-dns' } }
						},
						{ ipBlock: { cidr: '10.0.0.10/32' } }
					],
					ports: [
						{ protocol: 'UDP', port: 53 },
						{ protocol: 'TCP', port: 53 }
					]
				},
				{
					to: [{ ipBlock: { cidr: '0.0.0.0/0', except: ['100.64.0.0/10'] } }],
					ports: [
						{ protocol: 'TCP', port: 80 },
						{ protocol: 'TCP', port: 443 }
					]
				}
			] as V1NetworkPolicyEgressRule[]
		}
	});

	const defaultIngressRule = () => ({
		to: [
			{
				namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': INGRESS_CONTROLLER_NAMESPACE } },
				podSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } }
			}
		],
		ports: [
			{ protocol: 'TCP', port: 80 },
			{ protocol: 'TCP', port: 443 },
			{ protocol: 'TCP', port: 8000 },
			{ protocol: 'TCP', port: 8443 }
		]
	});

	const publicRule = (policy: ReturnType<typeof basePolicy>) =>
		policy.spec.egress.find(rule => rule.to?.some(target => target.ipBlock?.cidr === '0.0.0.0/0'));

	test('platform registry preserves custom chart rules and adds only registry-specific egress', () => {
		const original = basePolicy();
		const policy = registryAwareBuilderNetworkPolicy(original, {
			mode: 'platform',
			endpoint: 'registry.app.example.com',
			host: 'registry.app.example.com',
			insecure: false,
			pushSecretName: 'registry-creds',
			pullSecretName: 'kubwave-registry-pull',
			ingressEnabled: true,
			clusterIssuer: 'letsencrypt-prod'
		});

		expect(policy.spec?.egress?.[0]).toEqual(original.spec.egress[0]);
		expect(policy.spec?.egress?.[1]).toEqual(original.spec.egress[1]);
		expect(policy.spec?.egress).toContainEqual({
			to: [{ podSelector: { matchLabels: { 'app.kubernetes.io/name': 'registry' } } }],
			ports: [{ protocol: 'TCP', port: 5000 }]
		});
		expect(policy.spec?.egress).toContainEqual(defaultIngressRule());
	});

	test('platform registry drops stale external registry public ports', () => {
		const original = basePolicy();
		publicRule(original)?.ports!.push({ protocol: 'TCP', port: 5000 });

		const policy = registryAwareBuilderNetworkPolicy(
			original,
			{
				mode: 'platform',
				endpoint: 'registry.app.example.com',
				host: 'registry.app.example.com',
				insecure: false,
				pushSecretName: 'registry-creds',
				pullSecretName: 'kubwave-registry-pull',
				ingressEnabled: true
			},
			[5000]
		);
		const nextPublicRule = policy.spec?.egress?.find(rule => rule.to?.some(target => target.ipBlock?.cidr === '0.0.0.0/0'));

		expect(nextPublicRule?.ports).toEqual([
			{ protocol: 'TCP', port: 80 },
			{ protocol: 'TCP', port: 443 }
		]);
	});

	test('platform registry reuses a custom ingress-controller rule instead of replacing labels or ports', () => {
		const original = basePolicy();
		original.spec.egress.push({
			to: [
				{
					namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'edge' } },
					podSelector: { matchLabels: { app: 'custom-ingress' } }
				}
			],
			ports: [{ protocol: 'TCP', port: 9443 }]
		});

		const policy = registryAwareBuilderNetworkPolicy(original, {
			mode: 'platform',
			endpoint: 'registry.app.example.com',
			host: 'registry.app.example.com',
			insecure: false,
			pushSecretName: 'registry-creds',
			pullSecretName: 'kubwave-registry-pull',
			ingressEnabled: true
		});

		expect(policy.spec?.egress).toContainEqual(original.spec.egress[2]);
		expect(policy.spec?.egress).not.toContainEqual(defaultIngressRule());
	});

	test('platform registry drops stale worker-managed ingress defaults when a custom rule exists', () => {
		const original = basePolicy();
		const customIngressRule = {
			to: [
				{
					namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'edge' } },
					podSelector: { matchLabels: { app: 'custom-ingress' } }
				}
			],
			ports: [{ protocol: 'TCP', port: 9443 }]
		};
		original.metadata.annotations['kubwave.io/builder-networkpolicy-managed-ingress'] = 'true';
		original.spec.egress.push(defaultIngressRule(), customIngressRule);

		const policy = registryAwareBuilderNetworkPolicy(original, {
			mode: 'platform',
			endpoint: 'registry.app.example.com',
			host: 'registry.app.example.com',
			insecure: false,
			pushSecretName: 'registry-creds',
			pullSecretName: 'kubwave-registry-pull',
			ingressEnabled: true
		});

		expect(policy.spec?.egress).toContainEqual(customIngressRule);
		expect(policy.spec?.egress).not.toContainEqual(defaultIngressRule());
		expect(policy.metadata?.annotations?.['kubwave.io/builder-networkpolicy-managed-ingress']).toBeUndefined();
	});

	test('external registry drops stale default ingress egress from platform mode', () => {
		const original = basePolicy();
		original.spec.egress.push(defaultIngressRule());

		const policy = registryAwareBuilderNetworkPolicy(original, {
			mode: 'external',
			endpoint: 'registry.example.com/team',
			host: 'registry.example.com',
			insecure: false,
			pushSecretName: 'registry-creds',
			pullSecretName: 'kubwave-registry-pull',
			ingressEnabled: false
		});

		expect(policy.spec?.egress).not.toContainEqual(defaultIngressRule());
	});

	test('external registry replaces stale custom public ports without platform-only rules', () => {
		const original = basePolicy();
		publicRule(original)?.ports!.push({ protocol: 'TCP', port: 5000 });

		const policy = registryAwareBuilderNetworkPolicy(
			original,
			{
				mode: 'external',
				endpoint: 'registry.example.com:5001/team',
				host: 'registry.example.com:5001',
				insecure: false,
				pushSecretName: 'registry-creds',
				pullSecretName: 'kubwave-registry-pull',
				ingressEnabled: false
			},
			[5000]
		);
		const nextPublicRule = policy.spec?.egress?.find(rule => rule.to?.some(target => target.ipBlock?.cidr === '0.0.0.0/0'));

		expect(nextPublicRule?.to).toEqual([{ ipBlock: { cidr: '0.0.0.0/0', except: ['100.64.0.0/10'] } }]);
		expect(nextPublicRule?.ports).toEqual([
			{ protocol: 'TCP', port: 80 },
			{ protocol: 'TCP', port: 443 },
			{ protocol: 'TCP', port: 5001 }
		]);
		expect(policy.metadata?.annotations?.['kubwave.io/builder-networkpolicy-managed-public-ports']).toBe('5001');
	});

	test('external registry preserves unrelated custom public ports', () => {
		const original = basePolicy();
		publicRule(original)?.ports!.push({ protocol: 'TCP', port: 2222 });

		const policy = registryAwareBuilderNetworkPolicy(original, {
			mode: 'external',
			endpoint: 'registry.example.com:5001/team',
			host: 'registry.example.com:5001',
			insecure: false,
			pushSecretName: 'registry-creds',
			pullSecretName: 'kubwave-registry-pull',
			ingressEnabled: false
		});
		const nextPublicRule = policy.spec?.egress?.find(rule => rule.to?.some(target => target.ipBlock?.cidr === '0.0.0.0/0'));

		expect(nextPublicRule?.ports).toEqual([
			{ protocol: 'TCP', port: 80 },
			{ protocol: 'TCP', port: 443 },
			{ protocol: 'TCP', port: 2222 },
			{ protocol: 'TCP', port: 5001 }
		]);
	});

	test('external registry with custom port sets the public egress ports without platform-only rules', () => {
		const policy = registryAwareBuilderNetworkPolicy(basePolicy(), {
			mode: 'external',
			endpoint: 'registry.example.com:5000/team',
			host: 'registry.example.com:5000',
			insecure: false,
			pushSecretName: 'registry-creds',
			pullSecretName: 'kubwave-registry-pull',
			ingressEnabled: false
		});
		const publicRule = policy.spec?.egress?.find(rule => rule.to?.some(target => target.ipBlock?.cidr === '0.0.0.0/0'));

		expect(publicRule?.to).toEqual([{ ipBlock: { cidr: '0.0.0.0/0', except: ['100.64.0.0/10'] } }]);
		expect(publicRule?.ports).toEqual([
			{ protocol: 'TCP', port: 80 },
			{ protocol: 'TCP', port: 443 },
			{ protocol: 'TCP', port: 5000 }
		]);
		expect(policy.spec?.egress).not.toContainEqual({
			to: [{ podSelector: { matchLabels: { 'app.kubernetes.io/name': 'registry' } } }],
			ports: [{ protocol: 'TCP', port: 5000 }]
		});
	});
});
