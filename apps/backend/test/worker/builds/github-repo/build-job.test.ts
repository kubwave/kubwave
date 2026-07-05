import { describe, expect, test } from 'bun:test';
import {
	buildSourceJob,
	PREPARE_CONTAINER,
	NIXPACKS_CONTAINER,
	type SourceJobOptions
} from '~/modules/worker/jobs/deployments/deployers/public-repo/job';

// The github-repo build reuses public-repo's job-spec, adding only the installation-token auth header.
const BASE: SourceJobOptions = {
	deploymentId: 'dep-123',
	serviceId: 'svc-abc',
	imageRef: 'reg:5000/env-e1/svc-abc:dep-123',
	repoUrl: 'https://github.com/org/repo.git',
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
	gitTokenSecretName: 'github-repo-build-dep-123-token',
	gitTokenConfigKey: 'http.https://github.com/.extraheader',
	jobNamePrefix: 'github-repo-build'
};

const podSpecOf = (opts: SourceJobOptions) => buildSourceJob(opts).spec!.template!.spec!;
const initOf = (opts: SourceJobOptions, name: string) => podSpecOf(opts).initContainers!.find(c => c.name === name)!;

describe('buildSourceJob: github-repo token injection', () => {
	test('mounts the token Secret read-only on the prepare container only', () => {
		const prep = initOf(BASE, PREPARE_CONTAINER);
		const mount = prep.volumeMounts?.find(m => m.name === 'git-token');
		expect(mount?.mountPath).toBe('/git-token');
		expect(mount?.readOnly).toBe(true);
		expect(initOf(BASE, NIXPACKS_CONTAINER).volumeMounts?.some(m => m.name === 'git-token')).toBe(false);
		expect(podSpecOf(BASE).containers[0]!.volumeMounts?.some(m => m.name === 'git-token')).toBe(false);
	});

	test('projects the header under `extraheader` with owner-only mode', () => {
		const vol = podSpecOf(BASE).volumes?.find(v => v.name === 'git-token');
		expect(vol?.secret?.secretName).toBe('github-repo-build-dep-123-token');
		expect(vol?.secret?.items).toEqual([{ key: 'extraheader', path: 'extraheader' }]);
		expect(vol?.secret?.defaultMode).toBe(0o400);
	});

	test('passes the config key via env and applies it through GIT_CONFIG in the prepare script', () => {
		const prep = initOf(BASE, PREPARE_CONTAINER);
		expect(prep.env?.find(e => e.name === 'GIT_TOKEN_CONFIG_KEY')?.value).toBe('http.https://github.com/.extraheader');
		const script = prep.command?.[2] ?? '';
		expect(script).toContain('GIT_CONFIG_KEY_0="$GIT_TOKEN_CONFIG_KEY"');
		// The token is never interpolated into the repo URL.
		expect(script).not.toContain('x-access-token:');
	});

	test('no token wiring when gitTokenSecretName is absent (public-repo path)', () => {
		const { gitTokenSecretName, gitTokenConfigKey, ...noToken } = BASE;
		void gitTokenSecretName;
		void gitTokenConfigKey;
		expect(podSpecOf(noToken).volumes?.some(v => v.name === 'git-token')).toBe(false);
		expect(initOf(noToken, PREPARE_CONTAINER).volumeMounts?.some(m => m.name === 'git-token')).toBe(false);
	});
});
