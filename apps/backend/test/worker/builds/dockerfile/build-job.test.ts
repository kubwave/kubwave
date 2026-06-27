import { describe, expect, test } from 'bun:test';
import {
	buildDockerfileBuildJob,
	buildImageRef,
	buildJobName,
	COMPONENT_BUILDER,
	LABEL_COMPONENT,
	LABEL_DEPLOYMENT_ID,
	type DockerfileBuildJobOptions
} from '~/modules/worker/jobs/deployments/deployers/dockerfile/job';

const BASE: DockerfileBuildJobOptions = {
	deploymentId: 'dep-123',
	serviceId: 'svc-abc',
	imageRef: 'k3d-kubwave-registry:5000/env-e1/svc-abc:dep-123',
	configMapName: 'dockerfile-build-dep-123',
	builderImage: 'moby/buildkit:v0.31.0-rootless',
	insecure: true,
	serviceAccount: 'kubwave-builder',
	ttlSeconds: 3600,
	timeoutSeconds: 1800,
	memoryRequest: '1Gi',
	memoryLimit: '2Gi'
};

function jobOf(opts: DockerfileBuildJobOptions = BASE) {
	return buildDockerfileBuildJob(opts);
}

function containerOf(opts: DockerfileBuildJobOptions = BASE) {
	return jobOf(opts).spec!.template!.spec!.containers[0]!;
}

function envOf(opts: DockerfileBuildJobOptions = BASE) {
	return Object.fromEntries((containerOf(opts).env ?? []).map(e => [e.name, e.value]));
}

describe('buildImageRef', () => {
	test('scopes the repo per env+service and tags with the deployment id', () => {
		expect(buildImageRef('reg:5000', 'e1', 'abc', 'dep-123')).toBe('reg:5000/env-e1/svc-abc:dep-123');
	});
});

describe('buildDockerfileBuildJob', () => {
	test('names the Job deterministically off the deployment id', () => {
		expect(jobOf().metadata?.name).toBe(buildJobName('dep-123'));
		expect(jobOf().metadata?.name).toBe('dockerfile-build-dep-123');
	});

	test('is a one-shot Job: no retries, never restart, TTL + deadline set', () => {
		const spec = jobOf().spec!;
		expect(spec.backoffLimit).toBe(0);
		expect(spec.ttlSecondsAfterFinished).toBe(3600);
		expect(spec.activeDeadlineSeconds).toBe(1800);
		expect(spec.template.spec!.restartPolicy).toBe('Never');
	});

	test('runs as the builder SA with no API token mounted', () => {
		const podSpec = jobOf().spec!.template!.spec!;
		expect(podSpec.serviceAccountName).toBe('kubwave-builder');
		expect(podSpec.automountServiceAccountToken).toBe(false);
		expect(podSpec.securityContext?.fsGroup).toBe(1000);
	});

	test('labels the Job (and its pod template) for reaping + correlation', () => {
		const job = jobOf();
		for (const labels of [job.metadata?.labels, job.spec!.template!.metadata?.labels]) {
			expect(labels?.[LABEL_COMPONENT]).toBe(COMPONENT_BUILDER);
			expect(labels?.[LABEL_DEPLOYMENT_ID]).toBe('dep-123');
			expect(labels?.['kubwave/service-id']).toBe('svc-abc');
			expect(labels?.['app.kubernetes.io/managed-by']).toBe('kubwave-worker');
		}
	});

	test('runs daemonless rootless BuildKit against the mounted Dockerfile context', () => {
		const builder = containerOf();
		const args = builder.args ?? [];
		expect(builder.name).toBe('builder');
		expect(builder.image).toBe('moby/buildkit:v0.31.0-rootless');
		expect(builder.command).toEqual(['sh', '-ec', expect.stringContaining('buildctl-daemonless.sh'), 'buildctl-daemonless.sh']);
		expect(args).toEqual(
			expect.arrayContaining([
				'build',
				'--frontend',
				'dockerfile.v0',
				'--local',
				'context=/workspace',
				'--local',
				'dockerfile=/workspace',
				'--opt',
				'filename=Dockerfile',
				'--output',
				`type=image,name=${BASE.imageRef},push=true,registry.insecure=true`
			])
		);
		expect(args).not.toContain('--cache=true');
	});

	test('with a cacheRef: imports and exports the BuildKit registry cache', () => {
		const cacheRef = 'k3d-kubwave-registry:5000/env-e1/svc-abc:buildcache';
		const args = containerOf({ ...BASE, cacheRef }).args ?? [];
		expect(args).toContain('--import-cache');
		expect(args).toContain(`type=registry,ref=${cacheRef}`);
		expect(args).toContain('--export-cache');
		expect(args).toContain(`type=registry,ref=${cacheRef},mode=max`);
	});

	test('adds insecure registry handling only for a plain-HTTP registry', () => {
		const insecure = containerOf({ ...BASE, insecure: true });
		expect(insecure.args).toContain(`type=image,name=${BASE.imageRef},push=true,registry.insecure=true`);
		expect(envOf({ ...BASE, insecure: true }).BUILDKITD_FLAGS).toContain('--config=/home/user/.config/buildkit/buildkitd.toml');
		expect(envOf({ ...BASE, insecure: true }).BUILDKIT_REGISTRY_HOST).toBe('k3d-kubwave-registry:5000');

		const secure = containerOf({ ...BASE, insecure: false });
		expect(secure.args).toContain(`type=image,name=${BASE.imageRef},push=true`);
		expect(secure.args).not.toContain(`type=image,name=${BASE.imageRef},push=true,registry.insecure=true`);
		expect(envOf({ ...BASE, insecure: false }).BUILDKITD_FLAGS).toBe('--oci-worker-no-process-sandbox');
		expect('BUILDKIT_REGISTRY_HOST' in envOf({ ...BASE, insecure: false })).toBe(false);
	});

	test('runs rootless and bounds the build container memory', () => {
		const builder = containerOf({ ...BASE, memoryRequest: '1500Mi', memoryLimit: '3Gi' });
		expect(builder.securityContext).toMatchObject({
			runAsUser: 1000,
			runAsGroup: 1000,
			appArmorProfile: { type: 'Unconfined' },
			seccompProfile: { type: 'Unconfined' }
		});
		expect(builder.resources?.requests?.memory).toBe('1500Mi');
		expect(builder.resources?.limits?.memory).toBe('3Gi');
		expect(envOf().DOCKER_CONFIG).toBe('/home/user/.docker');
	});

	test('mounts the Dockerfile ConfigMap as the build context at /workspace', () => {
		const job = jobOf();
		const mount = containerOf().volumeMounts?.find(m => m.name === 'workspace');
		expect(mount?.mountPath).toBe('/workspace');
		const vol = job.spec!.template!.spec!.volumes?.find(v => v.name === 'workspace');
		expect(vol?.configMap?.name).toBe('dockerfile-build-dep-123');
		expect(vol?.configMap?.items).toEqual([{ key: 'Dockerfile', path: 'Dockerfile' }]);
	});

	test('mounts Docker config at the BuildKit path, using a secret only when configured', () => {
		const withoutAuth = jobOf();
		const emptyCfg = withoutAuth.spec!.template!.spec!.volumes?.find(v => v.name === 'docker-config');
		expect(emptyCfg?.emptyDir).toBeDefined();
		expect(containerOf().volumeMounts?.find(m => m.name === 'docker-config')?.mountPath).toBe('/home/user/.docker');

		const withAuth = jobOf({ ...BASE, insecure: false, pushConfigSecretName: 'registry-creds' });
		const cfgVol = withAuth.spec!.template!.spec!.volumes?.find(v => v.name === 'docker-config');
		expect(cfgVol?.secret?.secretName).toBe('registry-creds');
		expect(cfgVol?.secret?.items).toEqual([{ key: '.dockerconfigjson', path: 'config.json' }]);
		const cfgMount = withAuth.spec!.template!.spec!.containers[0]!.volumeMounts?.find(m => m.name === 'docker-config');
		expect(cfgMount?.mountPath).toBe('/home/user/.docker');
	});

	test('provides writable BuildKit config and state volumes', () => {
		const spec = jobOf().spec!.template!.spec!;
		expect(spec.volumes?.find(v => v.name === 'buildkit-state')?.emptyDir).toBeDefined();
		expect(spec.volumes?.find(v => v.name === 'buildkit-config')?.emptyDir).toBeDefined();
		expect(containerOf().volumeMounts?.find(m => m.name === 'buildkit-state')?.mountPath).toBe('/home/user/.local/share/buildkit');
		expect(containerOf().volumeMounts?.find(m => m.name === 'buildkit-config')?.mountPath).toBe('/home/user/.config/buildkit');
	});
});
