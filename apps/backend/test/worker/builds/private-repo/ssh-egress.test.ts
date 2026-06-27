import { describe, expect, test } from 'bun:test';
import type { NetworkingV1Api } from '@kubernetes/client-node';
import {
	buildSshEgressPolicy,
	ensureSshEgressPolicy,
	parsePrivateRepoSshPort,
	sshEgressPolicyName
} from '~/modules/worker/jobs/deployments/deployers/private-repo/ssh-egress';

describe('parsePrivateRepoSshPort', () => {
	test('defaults scp-style and ssh:// URLs to port 22', () => {
		expect(parsePrivateRepoSshPort('git@github.com:org/repo.git')).toBe(22);
		expect(parsePrivateRepoSshPort('ssh://git@gitea.example/org/repo.git')).toBe(22);
	});

	test('reads an explicit ssh:// port', () => {
		expect(parsePrivateRepoSshPort('ssh://git@gitea.example:2222/org/repo.git')).toBe(2222);
	});

	test('treats a numeric scp-style path as port 22, not a custom SSH port', () => {
		expect(parsePrivateRepoSshPort('git@gitea.example:2222/org/repo.git')).toBe(22);
	});

	test('rejects non-SSH and invalid SSH ports', () => {
		expect(() => parsePrivateRepoSshPort('https://github.com/org/repo')).toThrow(/Invalid private repository SSH URL/);
		expect(() => parsePrivateRepoSshPort('ssh://git@gitea.example:/org/repo.git')).toThrow(/Invalid private repository SSH URL/);
		expect(() => parsePrivateRepoSshPort('ssh://git@gitea.example:99999/org/repo.git')).toThrow(/Invalid private repository SSH URL/);
	});
});

describe('buildSshEgressPolicy', () => {
	test('selects only the build pod and allows the parsed SSH port to public IPv4 destinations', () => {
		const policy = buildSshEgressPolicy({
			namespace: 'kubwave',
			serviceId: 'svc-1',
			deploymentId: 'dep-1',
			port: 2222,
			blockedCidrs: ['10.0.0.0/8', '169.254.0.0/16']
		});
		expect(policy.metadata?.name).toBe(sshEgressPolicyName('dep-1'));
		expect(policy.metadata?.labels?.['kubwave/deployment-id']).toBe('dep-1');
		expect(policy.spec?.podSelector?.matchLabels).toMatchObject({
			'app.kubernetes.io/component': 'builder',
			'kubwave/deployment-id': 'dep-1'
		});
		expect(policy.spec?.policyTypes).toEqual(['Egress']);
		expect(policy.spec?.egress?.[0]?.ports).toEqual([{ protocol: 'TCP', port: 2222 }]);
		expect(policy.spec?.egress?.[0]?.to?.[0]?.ipBlock).toEqual({
			cidr: '0.0.0.0/0',
			except: ['10.0.0.0/8', '169.254.0.0/16']
		});
	});
});

describe('ensureSshEgressPolicy', () => {
	test('copies blocked CIDRs from kubwave-builder-egress into the per-build policy', async () => {
		let created: unknown;
		const api = {
			readNamespacedNetworkPolicy: () =>
				Promise.resolve({
					spec: {
						egress: [{ to: [{ ipBlock: { cidr: '0.0.0.0/0', except: ['10.0.0.0/8', '172.16.0.0/12'] } }] }]
					}
				}),
			createNamespacedNetworkPolicy: (req: { body: unknown }) => {
				created = req.body;
				return Promise.resolve({});
			}
		} as unknown as NetworkingV1Api;

		await ensureSshEgressPolicy({ api, namespace: 'kubwave', serviceId: 'svc-1', deploymentId: 'dep-1', port: 2222 });
		expect(
			(created as { spec?: { egress?: Array<{ to?: Array<{ ipBlock?: { except?: string[] } }> }> } }).spec?.egress?.[0]?.to?.[0]?.ipBlock?.except
		).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
	});

	test('skips the per-build policy when the static builder policy is disabled', async () => {
		let created = false;
		const api = {
			readNamespacedNetworkPolicy: () => Promise.reject({ code: 404 }),
			createNamespacedNetworkPolicy: () => {
				created = true;
				return Promise.resolve({});
			}
		} as unknown as NetworkingV1Api;

		await ensureSshEgressPolicy({ api, namespace: 'kubwave', serviceId: 'svc-1', deploymentId: 'dep-1', port: 22 });
		expect(created).toBe(false);
	});
});
