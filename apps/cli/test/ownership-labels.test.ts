import { describe, expect, test } from 'bun:test';
import { KUBWAVE_PART_OF_SELECTOR } from '../src/lib/constants.js';
import { buildOwnershipLabels } from '../src/lib/ownership.js';

describe('buildOwnershipLabels', () => {
	test('always stamps the part-of audit anchor and the component', () => {
		expect(buildOwnershipLabels({ component: 'ingress' })).toEqual({
			'app.kubernetes.io/part-of': 'kubwave',
			'app.kubernetes.io/component': 'ingress'
		});
	});

	test('adds the instance discriminator when given', () => {
		expect(buildOwnershipLabels({ component: 'csi-driver', instance: 'hetzner' })).toEqual({
			'app.kubernetes.io/part-of': 'kubwave',
			'app.kubernetes.io/component': 'csi-driver',
			'app.kubernetes.io/instance': 'hetzner'
		});
	});

	test('stamps managed-by=kubwave-cli only for resources the CLI fully owns', () => {
		const owned = buildOwnershipLabels({ component: 'csi-driver', instance: 'gcp', cliManaged: true });
		expect(owned['app.kubernetes.io/managed-by']).toBe('kubwave-cli');
	});

	test('omits managed-by for third-party (helm) output by default', () => {
		expect(buildOwnershipLabels({ component: 'database', instance: 'cnpg' })['app.kubernetes.io/managed-by']).toBeUndefined();
	});

	test('the selector matches the part-of anchor', () => {
		expect(KUBWAVE_PART_OF_SELECTOR).toBe('app.kubernetes.io/part-of=kubwave');
	});
});
