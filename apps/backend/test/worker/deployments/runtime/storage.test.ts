import { describe, expect, mock, test } from 'bun:test';
import type { ServiceVolume } from '@kubwave/db';

// buildPVC reads only env.storageClassName; everything else is pure (pvcName/commonLabels).
// commonLabels comes from the real networking module (pure helpers) so we don't mock it.
let storageClassName = '';
mock.module('~/shared/config/worker-env', () => ({
	env: {
		get storageClassName() {
			return storageClassName;
		}
	}
}));

const { buildPVC, hasVolume } = await import('~/modules/worker/jobs/deployments/deployers/runtime/storage');

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const volume: ServiceVolume = { name: 'data', mountPath: '/data', size: '5Gi' };

describe('buildPVC', () => {
	test('builds an RWO PVC named svc-<id>-<vol> requesting the configured size', () => {
		const pvc = buildPVC(SERVICE_ID, NAMESPACE, volume);
		expect(pvc.apiVersion).toBe('v1');
		expect(pvc.kind).toBe('PersistentVolumeClaim');
		expect(pvc.metadata?.name).toBe(`svc-${SERVICE_ID}-data`);
		expect(pvc.metadata?.namespace).toBe(NAMESPACE);
		expect(pvc.spec?.accessModes).toEqual(['ReadWriteOnce']);
		expect(pvc.spec?.resources?.requests?.storage).toBe('5Gi');
	});

	test('carries the service-id label so the API can address it', () => {
		const pvc = buildPVC(SERVICE_ID, NAMESPACE, volume);
		expect(pvc.metadata?.labels?.['kubwave/service-id']).toBe(SERVICE_ID);
	});

	test('omits storageClassName when env is unset (dev / cluster default)', () => {
		storageClassName = '';
		const pvc = buildPVC(SERVICE_ID, NAMESPACE, volume);
		expect(pvc.spec?.storageClassName).toBeUndefined();
		expect('storageClassName' in pvc.spec!).toBe(false);
	});

	test('sets storageClassName when env provides one', () => {
		storageClassName = 'fast-ssd';
		const pvc = buildPVC(SERVICE_ID, NAMESPACE, volume);
		expect(pvc.spec?.storageClassName).toBe('fast-ssd');
		storageClassName = '';
	});
});

describe('hasVolume', () => {
	const base = { containerPort: 8080, env: [], domains: [], volumes: [] };

	test('false when the config has no volumes', () => {
		expect(hasVolume({ ...base } as never)).toBe(false);
	});

	test('true when at least one volume is present', () => {
		expect(hasVolume({ ...base, volumes: [volume] } as never)).toBe(true);
	});
});
