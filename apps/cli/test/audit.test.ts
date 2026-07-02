import { describe, expect, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import { buildAuditReport, groupByComponent, type AuditedResource } from '../src/commands/audit.js';

function labelled(name: string, component: string, opts: { namespace?: string; instance?: string } = {}) {
	return {
		metadata: {
			name,
			...(opts.namespace ? { namespace: opts.namespace } : {}),
			labels: {
				'app.kubernetes.io/part-of': 'kubwave',
				'app.kubernetes.io/component': component,
				...(opts.instance ? { 'app.kubernetes.io/instance': opts.instance } : {})
			}
		}
	};
}

// One combined stub for every Api client buildAuditReport asks for; method names are distinct so they don't collide.
const apiStub = {
	listNamespace: async () => ({ items: [labelled('gce-pd-csi-driver', 'csi-driver', { instance: 'gcp' })] }),
	listDeploymentForAllNamespaces: async () => ({ items: [labelled('kubwave-api', 'platform', { namespace: 'kubwave' })] }),
	listDaemonSetForAllNamespaces: async () => ({ items: [] }),
	listStatefulSetForAllNamespaces: async () => ({ items: [] }),
	listServiceForAllNamespaces: async () => ({ items: [] }),
	listConfigMapForAllNamespaces: async () => ({ items: [] }),
	// A kind the caller can't list — must be recorded as skipped, not abort the audit.
	listSecretForAllNamespaces: async () => {
		throw new Error('secrets is forbidden');
	},
	listStorageClass: async () => ({ items: [] }),
	listCSIDriver: async () => ({ items: [labelled('csi.hetzner.cloud', 'csi-driver', { instance: 'hetzner' })] }),
	listClusterRole: async () => ({ items: [] }),
	listClusterRoleBinding: async () => ({ items: [] }),
	listCustomResourceDefinition: async () => ({ items: [] })
};

const mockKc = { makeApiClient: () => apiStub } as unknown as KubeConfig;

describe('buildAuditReport', () => {
	test('collects labelled resources across kinds', async () => {
		const report = await buildAuditReport(mockKc);
		expect(report.resources).toHaveLength(3);
		expect(report.resources).toContainEqual({ kind: 'CSIDriver', name: 'csi.hetzner.cloud', component: 'csi-driver', instance: 'hetzner' });
		expect(report.resources).toContainEqual({ kind: 'Namespace', name: 'gce-pd-csi-driver', component: 'csi-driver', instance: 'gcp' });
		expect(report.resources).toContainEqual({ kind: 'Deployment', name: 'kubwave-api', namespace: 'kubwave', component: 'platform' });
	});

	test('records kinds it could not list instead of aborting', async () => {
		const report = await buildAuditReport(mockKc);
		expect(report.skipped).toContain('Secret');
		// Everything else still came through.
		expect(report.resources.length).toBeGreaterThan(0);
	});
});

describe('groupByComponent', () => {
	test('buckets resources by their component label', () => {
		const resources: AuditedResource[] = [
			{ kind: 'CSIDriver', name: 'a', component: 'csi-driver' },
			{ kind: 'Namespace', name: 'b', component: 'csi-driver' },
			{ kind: 'Deployment', name: 'c', component: 'platform' }
		];
		const groups = groupByComponent(resources);
		expect(groups.get('csi-driver')).toHaveLength(2);
		expect(groups.get('platform')).toHaveLength(1);
	});

	test('falls back to a single bucket for resources without a component', () => {
		const groups = groupByComponent([{ kind: 'Secret', name: 'x' }]);
		expect(groups.get('(no component)')).toHaveLength(1);
	});
});
