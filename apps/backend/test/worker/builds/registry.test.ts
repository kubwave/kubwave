import { describe, expect, mock, test } from 'bun:test';

// The registry transitively imports all deployers, which read env at import and (via private-repo)
// pull in @kubwave/db + @kubwave/crypto. Stub them so it imports regardless of test load order.
mock.module('~/shared/config/worker-env', () => ({
	env: {
		podNamespace: 'kubwave',
		registryEndpoint: 'test-registry:5000',
		registryInsecure: true,
		builderImage: 'moby/buildkit:v0.31.0-rootless',
		buildToolsImage: 'ghcr.io/acme/build-tools:0.2.0',
		builderServiceAccount: 'kubwave-builder',
		buildJobTtlSeconds: 3600,
		buildTimeoutSeconds: 1800,
		buildMemoryRequest: '1Gi',
		buildMemoryLimit: '2Gi',
		registryPushSecretName: undefined,
		registryPullSecretName: undefined,
		storageClassName: ''
	}
}));
mock.module('@kubwave/db', () => ({ db: {}, sshKeys: {} }));
mock.module('@kubwave/crypto', () => ({ decryptSecret: (s: string) => s }));

const { getDeployer } = await import('~/modules/worker/jobs/deployments/deployers/registry');

describe('getDeployer', () => {
	// Each type resolves to a deployer whose own `type` matches the key, proving the map isn't cross-wired.
	test.each(['docker-image', 'dockerfile', 'public-repo', 'private-repo', 'postgres', 'mysql', 'mariadb', 'mongodb'] as const)(
		'resolves the %s deployer (type matches)',
		type => {
			const deployer = getDeployer(type);
			expect(deployer).toBeDefined();
			expect(deployer.type).toBe(type);
			expect(typeof deployer.reconcile).toBe('function');
			expect(typeof deployer.teardown).toBe('function');
		}
	);

	test('the same type always returns the same singleton deployer instance', () => {
		expect(getDeployer('dockerfile')).toBe(getDeployer('dockerfile'));
	});
});
