import { describe, expect, test } from 'bun:test';
import type { Deployment, DockerfileServiceConfig, DockerImageServiceConfig, RuntimeConfig } from '@kubwave/db';
import {
	buildDeployment,
	containerPorts,
	deploymentMatchesConfig,
	withDefaultDomain
} from '~/modules/worker/jobs/deployments/deployers/runtime/deployment';

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const IMAGE_REF = 'k3d-kubwave-registry:5000/env-1/svc-x:dep-1';
const deployment = { serviceId: SERVICE_ID } as Deployment;

// Identical runtime fields, just expressed through each service type's config.
const runtime: RuntimeConfig = {
	containerPort: 8080,
	env: [{ key: 'PUBLIC', value: 'hello' }],
	domains: [{ host: 'app.example.com', port: 8080 }],
	volumes: [],
	resources: { cpuRequest: '250m', memoryRequest: '256Mi' },
	healthCheck: { enabled: true, type: 'http', path: '/health' }
};
const imageConfig: DockerImageServiceConfig = { ...runtime, image: 'nginx', tag: 'latest' };
const dockerfileConfig: DockerfileServiceConfig = { ...runtime, dockerfile: 'FROM nginx:1.27\nRUN true' };

// The deploy core is image-source-agnostic: same RuntimeConfig + image ref → byte-identical Deployments for docker-image and dockerfile.
describe('reconcileRuntime shared deploy core', () => {
	test('docker-image and dockerfile configs render identical Deployments for the same imageRef', () => {
		const fromImage = buildDeployment(deployment, NAMESPACE, imageConfig, IMAGE_REF);
		const fromDockerfile = buildDeployment(deployment, NAMESPACE, dockerfileConfig, IMAGE_REF);
		expect(fromDockerfile).toEqual(fromImage);
	});

	test('the container image is the resolved ref, not anything from the config', () => {
		const container = buildDeployment(deployment, NAMESPACE, dockerfileConfig, IMAGE_REF).spec!.template!.spec!.containers[0]!;
		expect(container.image).toBe(IMAGE_REF);
		// The Dockerfile text never leaks into the rendered manifest.
		expect(JSON.stringify(container)).not.toContain('FROM nginx');
	});

	test('imagePullSecrets are injected only when a pull-secret name is supplied', () => {
		const without = buildDeployment(deployment, NAMESPACE, dockerfileConfig, IMAGE_REF);
		expect(without.spec!.template!.spec!.imagePullSecrets).toBeUndefined();

		const withSecret = buildDeployment(deployment, NAMESPACE, dockerfileConfig, IMAGE_REF, { imagePullSecretName: 'reg-pull' });
		expect(withSecret.spec!.template!.spec!.imagePullSecrets).toEqual([{ name: 'reg-pull' }]);
	});

	// subPath mounts a subdir of the volume so images like supabase/postgres can initdb past the lost+found ext4 PVs leave at the root.
	test('threads a volume subPath into the container volumeMount when set, and omits it otherwise', () => {
		const withSubPath: DockerImageServiceConfig = {
			...imageConfig,
			volumes: [{ name: 'data', mountPath: '/var/lib/postgresql/data', size: '8Gi', subPath: 'pgdata' }]
		};
		const container = buildDeployment(deployment, NAMESPACE, withSubPath, IMAGE_REF).spec!.template!.spec!.containers[0]!;
		const mount = container.volumeMounts!.find(m => m.name === 'data')!;
		expect(mount.mountPath).toBe('/var/lib/postgresql/data');
		expect(mount.subPath).toBe('pgdata');

		const withoutSubPath: DockerImageServiceConfig = {
			...imageConfig,
			volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }]
		};
		const plainMount = buildDeployment(deployment, NAMESPACE, withoutSubPath, IMAGE_REF).spec!.template!.spec!.containers[0]!.volumeMounts!.find(
			m => m.name === 'data'
		)!;
		expect(plainMount.subPath).toBeUndefined();
	});

	// deploymentMatchesConfig must fold subPath into the drift signature, else a subPath-mounted pod re-rolls every tick.
	test('deploymentMatchesConfig treats subPath as part of the volume drift signature', () => {
		const withSubPath: DockerImageServiceConfig = {
			...imageConfig,
			volumes: [{ name: 'data', mountPath: '/var/lib/postgresql/data', size: '8Gi', subPath: 'pgdata' }]
		};
		const built = buildDeployment(deployment, NAMESPACE, withSubPath, IMAGE_REF);
		// Same config still matches — no spurious re-roll loop for a subPath-mounted volume.
		expect(deploymentMatchesConfig(built, withSubPath, IMAGE_REF, SERVICE_ID)).toBe(true);
		// Losing the subPath (e.g. the console drops it) must read as drift, not a false match.
		const withoutSubPath: DockerImageServiceConfig = {
			...imageConfig,
			volumes: [{ name: 'data', mountPath: '/var/lib/postgresql/data', size: '8Gi' }]
		};
		expect(deploymentMatchesConfig(built, withoutSubPath, IMAGE_REF, SERVICE_ID)).toBe(false);
	});
});

// containerPorts feeds the Service layer; withDefaultDomain decides whether the generated fallback host applies.
describe('containerPorts', () => {
	test('returns the single container port when set', () => {
		expect(containerPorts({ ...runtime, containerPort: 8080 } as RuntimeConfig)).toEqual([8080]);
	});

	test('returns an empty list when no container port is exposed', () => {
		expect(containerPorts({ ...runtime, containerPort: null } as unknown as RuntimeConfig)).toEqual([]);
	});
});

describe('withDefaultDomain', () => {
	const noDomains: RuntimeConfig = { ...runtime, domains: [], containerPort: 8080 };
	const publicDefaultDomain: RuntimeConfig = { ...noDomains, defaultDomainEnabled: true };

	test('custom domains are canonical — the generated host is suppressed', () => {
		const custom: RuntimeConfig = { ...runtime, domains: [{ host: 'app.example.com', port: 8080 }], containerPort: 8080 };
		expect(withDefaultDomain(custom, 'svc.kubwave.app')).toEqual(custom.domains);
	});

	test('falls back to the generated host (paired with the HTTP port) when there are no custom domains', () => {
		expect(withDefaultDomain(publicDefaultDomain, 'svc.kubwave.app')).toEqual([{ host: 'svc.kubwave.app', port: 8080 }]);
	});

	test('no fallback when the default host is unset', () => {
		expect(withDefaultDomain(publicDefaultDomain, null)).toEqual([]);
	});

	test('no fallback when there is no HTTP port to route to', () => {
		const noPort = { ...runtime, domains: [], containerPort: null } as unknown as RuntimeConfig;
		expect(withDefaultDomain(noPort, 'svc.kubwave.app')).toEqual([]);
	});

	test('no fallback unless the service explicitly opts in', () => {
		expect(withDefaultDomain(noDomains, 'svc.kubwave.app')).toEqual([]);
	});

	test('no fallback when the service opts out', () => {
		const internalOnly = { ...runtime, domains: [], containerPort: 3306, defaultDomainEnabled: false };
		expect(withDefaultDomain(internalOnly, 'svc.kubwave.app')).toEqual([]);
	});
});
