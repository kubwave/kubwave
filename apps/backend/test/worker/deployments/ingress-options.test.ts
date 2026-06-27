import { describe, expect, mock, test } from 'bun:test';

// ingressOptions is a static object frozen at import from the three Ingress env knobs.
// Mock ~/env with only those keys to prove it threads each value through verbatim.
mock.module('~/shared/config/worker-env', () => ({
	env: {
		ingressClassName: 'traefik',
		ingressClusterIssuer: 'letsencrypt-prod',
		ingressAnnotations: { 'traefik.ingress.kubernetes.io/router.entrypoints': 'websecure' }
	}
}));

const { ingressOptions } = await import('~/modules/worker/jobs/deployments/ingress-options');

describe('ingressOptions', () => {
	test('threads the three Ingress env knobs through verbatim', () => {
		expect(ingressOptions).toEqual({
			className: 'traefik',
			clusterIssuer: 'letsencrypt-prod',
			annotations: { 'traefik.ingress.kubernetes.io/router.entrypoints': 'websecure' }
		});
	});
});
