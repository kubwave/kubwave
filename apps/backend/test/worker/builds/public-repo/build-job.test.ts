import { describe, expect, test } from 'bun:test';
import {
	BUILDER_CONTAINER,
	buildJobName,
	buildSourceJob,
	NIXPACKS_CONTAINER,
	PREPARE_CONTAINER,
	sourceBuildContainers,
	type SourceJobOptions
} from '~/modules/worker/jobs/deployments/deployers/public-repo/job';
import { COMPONENT_BUILDER, LABEL_COMPONENT, LABEL_DEPLOYMENT_ID } from '~/modules/worker/jobs/deployments/builds/service';

const BASE: SourceJobOptions = {
	deploymentId: 'dep-123',
	serviceId: 'svc-abc',
	imageRef: 'reg:5000/env-e1/svc-abc:dep-123',
	repoUrl: 'https://github.com/user/repo',
	branch: 'main',
	builder: 'nixpacks',
	buildEnv: [],
	buildToolsImage: 'ghcr.io/acme/build-tools:0.2.0',
	builderImage: 'moby/buildkit:v0.31.0-rootless',
	insecure: true,
	serviceAccount: 'kubwave-builder',
	ttlSeconds: 3600,
	timeoutSeconds: 1800,
	memoryRequest: '1Gi',
	memoryLimit: '2Gi'
};

const podSpecOf = (opts: SourceJobOptions) => buildSourceJob(opts).spec!.template!.spec!;
const initOf = (opts: SourceJobOptions, name: string) => podSpecOf(opts).initContainers!.find(c => c.name === name)!;
const builderOf = (opts: SourceJobOptions) => podSpecOf(opts).containers[0]!;
const envOf = (opts: SourceJobOptions) => Object.fromEntries((builderOf(opts).env ?? []).map(e => [e.name, e.value]));

describe('buildSourceJob: Job shape', () => {
	test('names the Job deterministically off the deployment id', () => {
		expect(buildSourceJob(BASE).metadata?.name).toBe(buildJobName('dep-123'));
		expect(buildSourceJob(BASE).metadata?.name).toBe('public-repo-build-dep-123');
	});

	test('is a one-shot Job: no retries, never restart, TTL + deadline set', () => {
		const spec = buildSourceJob(BASE).spec!;
		expect(spec.backoffLimit).toBe(0);
		expect(spec.ttlSecondsAfterFinished).toBe(3600);
		expect(spec.activeDeadlineSeconds).toBe(1800);
		expect(spec.template.spec!.restartPolicy).toBe('Never');
	});

	test('runs as the builder SA with no API token mounted', () => {
		const spec = podSpecOf(BASE);
		expect(spec.serviceAccountName).toBe('kubwave-builder');
		expect(spec.automountServiceAccountToken).toBe(false);
		expect(spec.securityContext?.fsGroup).toBe(1000);
	});

	test('labels the Job + pod template for reaping/correlation (shared with every build type)', () => {
		const job = buildSourceJob(BASE);
		for (const labels of [job.metadata?.labels, job.spec!.template!.metadata?.labels]) {
			expect(labels?.[LABEL_COMPONENT]).toBe(COMPONENT_BUILDER);
			expect(labels?.[LABEL_DEPLOYMENT_ID]).toBe('dep-123');
			expect(labels?.['kubwave/service-id']).toBe('svc-abc');
			expect(labels?.['app.kubernetes.io/managed-by']).toBe('kubwave-worker');
		}
	});
});

describe('buildSourceJob: prepare init container (clone)', () => {
	test('clones the repo (branch HEAD) via a static script with values passed as env', () => {
		const prep = initOf(BASE, PREPARE_CONTAINER);
		expect(prep.image).toBe('ghcr.io/acme/build-tools:0.2.0');
		expect(prep.command?.[0]).toBe('sh');
		expect(prep.securityContext?.runAsUser).toBe(0);
		const env = Object.fromEntries((prep.env ?? []).map(e => [e.name, e.value]));
		expect(env.SOURCE_REPO_URL).toBe('https://github.com/user/repo');
		expect(env.SOURCE_BRANCH).toBe('main');
		expect('SOURCE_COMMIT' in env).toBe(false);
		expect(prep.command?.[2]).not.toContain('https://github.com/user/repo');
	});

	test('does not download Nixpacks at runtime', () => {
		const script = initOf(BASE, PREPARE_CONTAINER).command?.[2] ?? '';
		expect(script).toContain('git clone');
		expect(script).not.toContain('releases/download');
		expect(script).not.toContain('curl');
		expect(script).not.toContain('/workspace/bin');
		expect(script).not.toContain('apt-get');
	});

	test('sets SOURCE_COMMIT only when a commit is pinned', () => {
		const prep = initOf({ ...BASE, commit: 'a1b2c3d' }, PREPARE_CONTAINER);
		const env = Object.fromEntries((prep.env ?? []).map(e => [e.name, e.value]));
		expect(env.SOURCE_COMMIT).toBe('a1b2c3d');
	});

	test('injects image pull secrets into the generated build pod when configured', () => {
		expect(podSpecOf(BASE).imagePullSecrets).toBeUndefined();
		expect(podSpecOf({ ...BASE, imagePullSecrets: ['regcred', 'mirror'] }).imagePullSecrets).toEqual([{ name: 'regcred' }, { name: 'mirror' }]);
	});
});

describe('buildSourceJob: nixpacks init container', () => {
	test('execs the preinstalled CLI to generate a Dockerfile in the repo root', () => {
		const nix = initOf(BASE, NIXPACKS_CONTAINER);
		expect(nix.image).toBe('ghcr.io/acme/build-tools:0.2.0');
		expect(nix.workingDir).toBe('/workspace/src');
		expect(nix.command).toEqual(['nixpacks']);
		expect(nix.args?.slice(0, 4)).toEqual(['build', '.', '--out', '.']);
		expect(nix.args).not.toContain('--no-cache');
	});

	test('passes build env as discrete --env KEY=VALUE argv (no shell, injection-safe)', () => {
		const nix = initOf({ ...BASE, buildEnv: [{ key: 'NODE_ENV', value: 'production' }] }, NIXPACKS_CONTAINER);
		const args = nix.args ?? [];
		const i = args.indexOf('--env');
		expect(i).toBeGreaterThanOrEqual(0);
		expect(args[i + 1]).toBe('NODE_ENV=production');
	});

	test('sets NIXPACKS_* build env on the CLI process so provider config affects plan generation', () => {
		const nix = initOf(
			{
				...BASE,
				buildEnv: [
					{ key: 'NIXPACKS_NODE_VERSION', value: '23' },
					{ key: 'APP_ENV', value: 'production' }
				]
			},
			NIXPACKS_CONTAINER
		);
		expect(nix.args).toContain('NIXPACKS_NODE_VERSION=23');
		expect(nix.args).toContain('APP_ENV=production');
		expect(nix.env).toEqual([{ name: 'NIXPACKS_NODE_VERSION', value: '23' }]);
	});

	test('forwards build/start command overrides as flags', () => {
		const nix = initOf({ ...BASE, buildCommand: 'npm run build', startCommand: 'node x.js' }, NIXPACKS_CONTAINER);
		const args = nix.args ?? [];
		expect(args[args.indexOf('--build-cmd') + 1]).toBe('npm run build');
		expect(args[args.indexOf('--start-cmd') + 1]).toBe('node x.js');
	});

	test('omits the override flags when not set', () => {
		const nix = initOf(BASE, NIXPACKS_CONTAINER);
		expect(nix.args).not.toContain('--build-cmd');
		expect(nix.args).not.toContain('--start-cmd');
	});
});

describe('buildSourceJob: builder container', () => {
	test('builds the generated Dockerfile against the repo context and pushes the image', () => {
		const builder = builderOf(BASE);
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
				'context=/workspace/src',
				'--local',
				'dockerfile=/workspace/src',
				'--opt',
				'filename=.nixpacks/Dockerfile',
				'--output',
				'type=image,name=reg:5000/env-e1/svc-abc:dep-123,push=true,registry.insecure=true'
			])
		);
	});

	test('adds BuildKit insecure registry handling for a plain-HTTP registry', () => {
		expect(builderOf(BASE).args).toContain('type=image,name=reg:5000/env-e1/svc-abc:dep-123,push=true,registry.insecure=true');
		expect(envOf(BASE).BUILDKIT_REGISTRY_HOST).toBe('reg:5000');
		expect(builderOf({ ...BASE, insecure: false }).args).toContain('type=image,name=reg:5000/env-e1/svc-abc:dep-123,push=true');
		expect('BUILDKIT_REGISTRY_HOST' in envOf({ ...BASE, insecure: false })).toBe(false);
	});

	test('runs rootless and bounds the build container with a memory request + limit', () => {
		const builder = builderOf({ ...BASE, memoryRequest: '1500Mi', memoryLimit: '3Gi' });
		expect(builder.securityContext).toMatchObject({
			runAsUser: 1000,
			runAsGroup: 1000,
			appArmorProfile: { type: 'Unconfined' },
			seccompProfile: { type: 'Unconfined' }
		});
		expect(builder.resources?.requests?.memory).toBe('1500Mi');
		expect(builder.resources?.limits?.memory).toBe('3Gi');
		expect(envOf(BASE).DOCKER_CONFIG).toBe('/home/user/.docker');
	});
});

describe('buildSourceJob: BuildKit registry cache', () => {
	const CACHE = 'reg:5000/env-e1/svc-abc:buildcache';

	test('with a cacheRef: imports and exports the registry cache', () => {
		const builder = builderOf({ ...BASE, cacheRef: CACHE });
		expect(builder.args).toContain('--import-cache');
		expect(builder.args).toContain(`type=registry,ref=${CACHE}`);
		expect(builder.args).toContain('--export-cache');
		expect(builder.args).toContain(`type=registry,ref=${CACHE},mode=max`);
	});

	test('without a cacheRef: emits no registry cache flags', () => {
		const args = builderOf(BASE).args ?? [];
		expect(args).not.toContain('--import-cache');
		expect(args).not.toContain('--export-cache');
		expect(args.some(a => a.startsWith('type=registry,ref='))).toBe(false);
	});

	test('the dockerfile builder caches too (repo-own Dockerfile)', () => {
		const builder = builderOf({ ...BASE, builder: 'dockerfile', cacheRef: CACHE });
		expect(builder.args).toContain('--import-cache');
		expect(builder.args).toContain(`type=registry,ref=${CACHE}`);
		expect(builder.args).toContain('--export-cache');
		expect(builder.args).toContain(`type=registry,ref=${CACHE},mode=max`);
	});
});

describe('buildSourceJob: root directory + push secret', () => {
	test('a monorepo root directory shifts the nixpacks workdir and the BuildKit context', () => {
		const opts = { ...BASE, rootDirectory: 'apps/web' };
		expect(initOf(opts, NIXPACKS_CONTAINER).workingDir).toBe('/workspace/src/apps/web');
		expect(builderOf(opts).args).toContain('context=/workspace/src/apps/web');
	});

	test('mounts Docker config at the BuildKit path, using a secret only when configured', () => {
		const baseVol = podSpecOf(BASE).volumes?.find(v => v.name === 'docker-config');
		expect(baseVol?.emptyDir).toBeDefined();
		const withSecret = podSpecOf({ ...BASE, pushConfigSecretName: 'registry-push' });
		expect(withSecret.volumes?.find(v => v.name === 'docker-config')?.secret?.secretName).toBe('registry-push');
		expect(withSecret.containers[0]!.volumeMounts?.some(m => m.mountPath === '/home/user/.docker')).toBe(true);
	});

	test('every container shares the workspace volume', () => {
		const spec = podSpecOf(BASE);
		for (const c of [...(spec.initContainers ?? []), ...spec.containers]) {
			expect(c.volumeMounts?.some(m => m.name === 'workspace' && m.mountPath === '/workspace')).toBe(true);
		}
		expect(spec.volumes?.find(v => v.name === 'workspace')?.emptyDir).toBeDefined();
	});
});

describe('buildSourceJob: container names', () => {
	test('exposes prepare → nixpacks init order, then builder as the build container', () => {
		const spec = podSpecOf(BASE);
		expect(spec.initContainers?.map(c => c.name)).toEqual([PREPARE_CONTAINER, NIXPACKS_CONTAINER]);
		expect(spec.containers.map(c => c.name)).toEqual([BUILDER_CONTAINER]);
	});
});

describe('buildSourceJob: dockerfile builder', () => {
	const DF: SourceJobOptions = { ...BASE, builder: 'dockerfile' };

	test('drops the nixpacks init container — pod is prepare → builder', () => {
		const spec = podSpecOf(DF);
		expect(spec.initContainers?.map(c => c.name)).toEqual([PREPARE_CONTAINER]);
		expect(spec.containers.map(c => c.name)).toEqual([BUILDER_CONTAINER]);
	});

	test('prepare clones only — no Nixpacks CLI download', () => {
		const script = initOf(DF, PREPARE_CONTAINER).command?.[2] ?? '';
		expect(script).toContain('git clone');
		expect(script).not.toContain('releases/download');
		expect(script).not.toContain('/workspace/bin');
	});

	test("BuildKit builds the repo's Dockerfile against the cloned tree (default path)", () => {
		const builder = builderOf(DF);
		expect(builder.args).toContain('filename=Dockerfile');
		expect(builder.args).toContain('context=/workspace/src');
		expect(builder.args).toContain('type=image,name=reg:5000/env-e1/svc-abc:dep-123,push=true,registry.insecure=true');
		expect(builder.args).not.toContain('filename=.nixpacks/Dockerfile');
	});

	test('honours a custom dockerfilePath + monorepo root directory', () => {
		const builder = builderOf({ ...DF, dockerfilePath: 'docker/Dockerfile', rootDirectory: 'apps/api' });
		expect(builder.args).toContain('filename=docker/Dockerfile');
		expect(builder.args).toContain('context=/workspace/src/apps/api');
	});

	test('passes plaintext env as BuildKit build args (parity with nixpacks --env)', () => {
		const args = builderOf({ ...DF, buildEnv: [{ key: 'NODE_ENV', value: 'production' }] }).args ?? [];
		const i = args.indexOf('--opt');
		expect(args).toContain('build-arg:NODE_ENV=production');
		expect(i).toBeGreaterThanOrEqual(0);
	});

	test('still injects the SSH deploy key (private repo over its own Dockerfile)', () => {
		const opts = { ...DF, sshKeySecretName: 'private-repo-build-dep-123-ssh', jobNamePrefix: 'private-repo-build' };
		const prep = initOf(opts, PREPARE_CONTAINER);
		expect(prep.volumeMounts?.some(m => m.name === 'ssh-key')).toBe(true);
		expect(prep.command?.[2] ?? '').toContain('GIT_SSH_COMMAND=');
		expect(podSpecOf(opts).volumes?.some(v => v.name === 'ssh-key')).toBe(true);
	});
});

describe('sourceBuildContainers', () => {
	test('nixpacks → prepare, nixpacks, builder', () => {
		expect(sourceBuildContainers('nixpacks')).toEqual([PREPARE_CONTAINER, NIXPACKS_CONTAINER, BUILDER_CONTAINER]);
	});
	test('dockerfile → prepare, builder (no nixpacks)', () => {
		expect(sourceBuildContainers('dockerfile')).toEqual([PREPARE_CONTAINER, BUILDER_CONTAINER]);
	});
});
