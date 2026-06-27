import { describe, expect, test } from 'bun:test';
import { CNPG_CLUSTER_NAME, CNPG_GROUP, CNPG_PLURAL, CNPG_VERSION, type CnpgCluster } from '~/modules/worker/jobs/platform/cnpg';

// cnpg.ts is the single source of truth for the CNPG Cluster coordinates (group/version/plural + name).

describe('CNPG coordinates', () => {
	test('group/version/plural form the CNPG Cluster apiVersion + resource', () => {
		expect(CNPG_GROUP).toBe('postgresql.cnpg.io');
		expect(CNPG_VERSION).toBe('v1');
		expect(CNPG_PLURAL).toBe('clusters');
		expect(`${CNPG_GROUP}/${CNPG_VERSION}`).toBe('postgresql.cnpg.io/v1');
	});

	test('the cluster name is re-exported from @kubwave/kube (single source with the api usage read)', () => {
		expect(CNPG_CLUSTER_NAME).toBe('postgres');
	});
});

describe('CnpgCluster type', () => {
	test('the minimal view carries the instances/affinity/storage the worker reads and writes', () => {
		// Type-level: a fully-populated value assigns cleanly; operator/chart fields survive via the index signature.
		const cluster: CnpgCluster = {
			metadata: { annotations: { 'kubwave/last-expanded-at': '2026-06-17T00:00:00Z' }, uid: 'c1' },
			spec: {
				instances: 3,
				affinity: { enablePodAntiAffinity: true, topologyKey: 'kubernetes.io/hostname', podAntiAffinityType: 'preferred' },
				storage: { size: '20Gi', storageClass: 'standard' }
			}
		};
		expect(cluster.spec?.instances).toBe(3);
		expect(cluster.spec?.affinity?.enablePodAntiAffinity).toBe(true);
		expect(cluster.spec?.storage?.size).toBe('20Gi');
		expect(cluster.metadata?.annotations?.['kubwave/last-expanded-at']).toBe('2026-06-17T00:00:00Z');
	});
});
