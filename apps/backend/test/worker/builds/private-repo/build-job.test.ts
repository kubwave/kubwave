import { describe, expect, test } from 'bun:test';
import {
	buildJobName,
	buildSourceJob,
	PREPARE_CONTAINER,
	NIXPACKS_CONTAINER,
	type SourceJobOptions
} from '~/modules/worker/jobs/deployments/deployers/public-repo/job';

// The private-repo build reuses public-repo's job-spec, adding only the SSH deploy-key injection.
const BASE: SourceJobOptions = {
	deploymentId: 'dep-123',
	serviceId: 'svc-abc',
	imageRef: 'reg:5000/env-e1/svc-abc:dep-123',
	repoUrl: 'git@github.com:org/repo.git',
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
	memoryLimit: '2Gi',
	sshKeySecretName: 'private-repo-build-dep-123-ssh',
	jobNamePrefix: 'private-repo-build'
};

const podSpecOf = (opts: SourceJobOptions) => buildSourceJob(opts).spec!.template!.spec!;
const initOf = (opts: SourceJobOptions, name: string) => podSpecOf(opts).initContainers!.find(c => c.name === name)!;

describe('buildSourceJob: private-repo SSH key injection', () => {
	test('names the Job with the private-repo prefix', () => {
		expect(buildSourceJob(BASE).metadata?.name).toBe(buildJobName('dep-123', 'private-repo-build'));
		expect(buildSourceJob(BASE).metadata?.name).toBe('private-repo-build-dep-123');
	});

	test('mounts the deploy-key Secret read-only on the prepare container only', () => {
		const spec = podSpecOf(BASE);
		const prep = initOf(BASE, PREPARE_CONTAINER);
		const mount = prep.volumeMounts?.find(m => m.name === 'ssh-key');
		expect(mount?.mountPath).toBe('/ssh-key');
		expect(mount?.readOnly).toBe(true);
		// nixpacks (and builder) never see the key.
		expect(initOf(BASE, NIXPACKS_CONTAINER).volumeMounts?.some(m => m.name === 'ssh-key')).toBe(false);
		expect(spec.containers[0]!.volumeMounts?.some(m => m.name === 'ssh-key')).toBe(false);
	});

	test('projects the private key under `id` with owner-only mode', () => {
		const vol = podSpecOf(BASE).volumes?.find(v => v.name === 'ssh-key');
		expect(vol?.secret?.secretName).toBe('private-repo-build-dep-123-ssh');
		expect(vol?.secret?.items).toEqual([{ key: 'id', path: 'id' }]);
		expect(vol?.secret?.defaultMode).toBe(0o400);
	});

	test('the prepare script configures GIT_SSH_COMMAND with accept-new and a chmod 600 copy', () => {
		const script = initOf(BASE, PREPARE_CONTAINER).command?.[2] ?? '';
		expect(script).toContain('GIT_SSH_COMMAND=');
		expect(script).toContain('StrictHostKeyChecking=accept-new');
		expect(script).toContain('chmod 600');
		expect(script).toContain('command -v ssh');
		expect(script).not.toContain('apt-get');
		expect(script).not.toContain('openssh-client');
		// The clone still reads the URL from env, never spliced into the script text.
		expect(script).not.toContain('git@github.com:org/repo.git');
	});
});

describe('buildSourceJob: public-repo path stays key-free', () => {
	const PUBLIC: SourceJobOptions = {
		...BASE,
		repoUrl: 'https://github.com/org/repo',
		sshKeySecretName: undefined,
		jobNamePrefix: undefined
	};

	test('no ssh-key volume or mount when no key secret is configured', () => {
		const spec = podSpecOf(PUBLIC);
		expect(spec.volumes?.some(v => v.name === 'ssh-key')).toBe(false);
		for (const c of [...(spec.initContainers ?? []), ...spec.containers]) {
			expect(c.volumeMounts?.some(m => m.name === 'ssh-key')).toBe(false);
		}
	});

	test('defaults to the public-repo job name prefix', () => {
		expect(buildSourceJob(PUBLIC).metadata?.name).toBe('public-repo-build-dep-123');
	});
});
