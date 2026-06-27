import { describe, expect, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import { CERT_MANAGER_ACME_SERVER, CERT_MANAGER_CLUSTER_ISSUER_NAME } from '../src/lib/constants.js';
import { FatalCliError } from '../src/lib/errors.js';
import { resolveCertManagerClusterIssuer } from '../src/lib/cert-manager.js';

const dependencyInput = {
	traefik: {
		kind: 'traefik' as const,
		namespace: 'traefik',
		releaseName: 'traefik',
		ingressClassName: 'traefik',
		helmValues: {}
	}
};

function clusterIssuer(overrides: { server?: string; email?: string; ingressClassName?: string } = {}) {
	return {
		spec: {
			acme: {
				server: overrides.server ?? CERT_MANAGER_ACME_SERVER,
				email: overrides.email ?? 'ops@example.com',
				solvers: [
					{
						http01: {
							ingress: {
								ingressClassName: overrides.ingressClassName ?? 'traefik'
							}
						}
					}
				]
			}
		}
	};
}

function kubeConfigReturning(result: unknown, calls: unknown[] = []): KubeConfig {
	return {
		makeApiClient: () => ({
			getClusterCustomObject: async (params: unknown) => {
				calls.push(params);
				if (result instanceof Error || (typeof result === 'object' && result !== null && 'code' in result)) throw result;
				return result;
			}
		})
	} as unknown as KubeConfig;
}

describe('cert-manager ClusterIssuer resolution', () => {
	test('creates the expected issuer when it is missing', async () => {
		const calls: unknown[] = [];
		const result = await resolveCertManagerClusterIssuer(kubeConfigReturning({ code: 404 }, calls), {
			email: 'ops@example.com',
			dependencies: dependencyInput
		});

		expect(result).toEqual({
			action: 'create',
			clusterIssuer: {
				name: CERT_MANAGER_CLUSTER_ISSUER_NAME,
				create: true,
				email: 'ops@example.com'
			},
			emailMismatch: false
		});
		expect(calls).toEqual([
			{
				group: 'cert-manager.io',
				version: 'v1',
				plural: 'clusterissuers',
				name: CERT_MANAGER_CLUSTER_ISSUER_NAME
			}
		]);
	});

	test('reuses a compatible existing issuer', async () => {
		const result = await resolveCertManagerClusterIssuer(kubeConfigReturning(clusterIssuer()), {
			email: 'ops@example.com',
			dependencies: dependencyInput
		});

		expect(result).toEqual({
			action: 'reuse',
			clusterIssuer: {
				name: CERT_MANAGER_CLUSTER_ISSUER_NAME,
				create: false
			},
			existingEmail: 'ops@example.com',
			emailMismatch: false
		});
	});

	test('reuses a compatible existing issuer with a different email and reports the mismatch', async () => {
		const result = await resolveCertManagerClusterIssuer(kubeConfigReturning(clusterIssuer({ email: 'old@example.com' })), {
			email: 'ops@example.com',
			dependencies: dependencyInput
		});

		expect(result).toMatchObject({
			action: 'reuse',
			clusterIssuer: {
				name: CERT_MANAGER_CLUSTER_ISSUER_NAME,
				create: false
			},
			existingEmail: 'old@example.com',
			emailMismatch: true
		});
	});

	test('fails when an existing issuer points at a different ACME server', async () => {
		await expect(
			resolveCertManagerClusterIssuer(kubeConfigReturning(clusterIssuer({ server: 'https://example.invalid/directory' })), {
				email: 'ops@example.com',
				dependencies: dependencyInput
			})
		).rejects.toThrow(FatalCliError);
		await expect(
			resolveCertManagerClusterIssuer(kubeConfigReturning(clusterIssuer({ server: 'https://example.invalid/directory' })), {
				email: 'ops@example.com',
				dependencies: dependencyInput
			})
		).rejects.toThrow('ACME server');
	});

	test('fails when an existing issuer does not solve through the resolved ingress class', async () => {
		await expect(
			resolveCertManagerClusterIssuer(kubeConfigReturning(clusterIssuer({ ingressClassName: 'nginx' })), {
				email: 'ops@example.com',
				dependencies: dependencyInput
			})
		).rejects.toThrow('ingressClassName "traefik"');
	});

	test('propagates non-404 Kubernetes read errors', async () => {
		const err = { code: 403, message: 'forbidden' };
		try {
			await resolveCertManagerClusterIssuer(kubeConfigReturning(err), {
				email: 'ops@example.com',
				dependencies: dependencyInput
			});
			throw new Error('expected resolver to throw');
		} catch (caught) {
			expect(caught).toBe(err);
		}
	});
});
