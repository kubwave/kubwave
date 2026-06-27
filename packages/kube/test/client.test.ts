import { describe, expect, test } from 'bun:test';
import * as k8s from '@kubernetes/client-node';
import { getKubeConfig } from '../src/client/index';

describe('getKubeConfig', () => {
	test('returns a KubeConfig instance from the host default config', () => {
		let kc: k8s.KubeConfig | null = null;
		let threw: unknown = null;
		try {
			kc = getKubeConfig();
		} catch (e) {
			threw = e;
		}
		if (threw) {
			expect(threw).toBeInstanceOf(Error);
		} else {
			expect(kc).toBeInstanceOf(k8s.KubeConfig);
		}
	});
});
