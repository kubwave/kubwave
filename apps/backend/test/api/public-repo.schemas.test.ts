import { describe, expect, test } from 'bun:test';
import { createServiceSchema, publicRepoConfigSchema } from '~/modules/services/services.dto';
import { buildStoredPublicRepoConfig } from '~/modules/services/services.config';

const baseConfig = { repoUrl: 'https://github.com/user/repo', branch: 'main', containerPort: 3000, env: [] };

describe('publicRepoConfigSchema', () => {
	test('accepts a public http(s) repo with a branch', () => {
		expect(publicRepoConfigSchema.safeParse(baseConfig).success).toBe(true);
	});

	test('defaults the branch to main when omitted', () => {
		const result = publicRepoConfigSchema.safeParse({ repoUrl: 'https://github.com/user/repo', containerPort: null, env: [] });
		expect(result.success).toBe(true);
		expect(result.success && result.data.branch).toBe('main');
	});

	test('rejects a non-http(s) repo URL', () => {
		expect(publicRepoConfigSchema.safeParse({ ...baseConfig, repoUrl: 'git@github.com:user/repo.git' }).success).toBe(false);
	});

	test('accepts a pinned commit SHA', () => {
		expect(publicRepoConfigSchema.safeParse({ ...baseConfig, commit: 'a1b2c3d4e5f6' }).success).toBe(true);
	});

	test('rejects a non-hex commit', () => {
		expect(publicRepoConfigSchema.safeParse({ ...baseConfig, commit: 'not-a-sha!' }).success).toBe(false);
	});

	test('rejects a root directory that traverses outside the repo', () => {
		expect(publicRepoConfigSchema.safeParse({ ...baseConfig, rootDirectory: '../etc' }).success).toBe(false);
	});

	test('still enforces the shared runtime rules (autoscaling + volume are exclusive)', () => {
		const result = publicRepoConfigSchema.safeParse({
			...baseConfig,
			resources: { cpuRequest: '250m' },
			volumes: [{ name: 'data', mountPath: '/data', size: '1Gi' }],
			autoscaling: { enabled: true, maxReplicas: 3, targetCpuUtilizationPercentage: 70 }
		});
		expect(result.success).toBe(false);
		const messages = result.success ? [] : result.error.issues.map(i => i.message);
		expect(messages.some(m => m.includes('persistent volume'))).toBe(true);
	});
});

describe('createServiceSchema (public-repo branch)', () => {
	test('a public-repo service validates against the public-repo config', () => {
		expect(createServiceSchema.safeParse({ name: 'web', type: 'public-repo', config: baseConfig }).success).toBe(true);
	});

	test('a public-repo service rejects a dockerfile config (no repoUrl)', () => {
		const result = createServiceSchema.safeParse({
			name: 'web',
			type: 'public-repo',
			config: { dockerfile: 'FROM nginx', containerPort: 80, env: [] }
		});
		expect(result.success).toBe(false);
	});
});

describe('buildStoredPublicRepoConfig', () => {
	test('trims fields and drops empty optionals', () => {
		const stored = buildStoredPublicRepoConfig(
			{
				repoUrl: '  https://github.com/user/repo  ',
				branch: '  main  ',
				commit: '',
				rootDirectory: '',
				buildCommand: '',
				startCommand: '',
				builder: 'nixpacks',
				containerPort: 3000,
				env: [] as { key: string; value: string }[],
				secrets: [] as { key: string; value: string | null }[],
				domains: [] as { host: string; port: number }[],
				volumes: [] as { name: string; mountPath: string; size: string }[]
			},
			[]
		);
		expect(stored.repoUrl).toBe('https://github.com/user/repo');
		expect(stored.branch).toBe('main');
		expect('commit' in stored).toBe(false);
		expect('rootDirectory' in stored).toBe(false);
		expect('buildCommand' in stored).toBe(false);
		expect('startCommand' in stored).toBe(false);
	});

	test('keeps set optionals (commit, root dir, build/start commands)', () => {
		const stored = buildStoredPublicRepoConfig(
			{
				repoUrl: 'https://github.com/user/repo',
				branch: 'release',
				commit: 'a1b2c3d',
				rootDirectory: 'apps/web',
				buildCommand: 'npm run build',
				startCommand: 'node dist/server.js',
				builder: 'nixpacks',
				containerPort: 3000,
				env: [] as { key: string; value: string }[],
				secrets: [] as { key: string; value: string | null }[],
				domains: [] as { host: string; port: number }[],
				volumes: [] as { name: string; mountPath: string; size: string }[]
			},
			[]
		);
		expect(stored.commit).toBe('a1b2c3d');
		expect(stored.rootDirectory).toBe('apps/web');
		expect(stored.buildCommand).toBe('npm run build');
		expect(stored.startCommand).toBe('node dist/server.js');
	});
});

describe('publicRepoConfigSchema: builder', () => {
	test('defaults builder to nixpacks when omitted', () => {
		const result = publicRepoConfigSchema.safeParse(baseConfig);
		expect(result.success).toBe(true);
		expect(result.success && result.data.builder).toBe('nixpacks');
	});

	test('accepts builder=dockerfile with a dockerfilePath', () => {
		expect(publicRepoConfigSchema.safeParse({ ...baseConfig, builder: 'dockerfile', dockerfilePath: 'docker/Dockerfile' }).success).toBe(true);
	});

	test('rejects an unknown builder', () => {
		expect(publicRepoConfigSchema.safeParse({ ...baseConfig, builder: 'buildpacks' }).success).toBe(false);
	});

	test('rejects a dockerfilePath that traverses outside the repo', () => {
		expect(publicRepoConfigSchema.safeParse({ ...baseConfig, builder: 'dockerfile', dockerfilePath: '../Dockerfile' }).success).toBe(false);
	});
});

describe('buildStoredPublicRepoConfig: builder normalization', () => {
	const base = { repoUrl: 'https://github.com/user/repo', branch: 'main', containerPort: 3000, env: [], secrets: [], domains: [], volumes: [] };

	test('nixpacks mode drops dockerfilePath, keeps build/start commands', () => {
		const stored = buildStoredPublicRepoConfig(
			{ ...base, builder: 'nixpacks', dockerfilePath: 'Dockerfile', buildCommand: 'npm run build', startCommand: 'node x.js' },
			[]
		);
		expect(stored.builder).toBe('nixpacks');
		expect('dockerfilePath' in stored).toBe(false);
		expect(stored.buildCommand).toBe('npm run build');
		expect(stored.startCommand).toBe('node x.js');
	});

	test('dockerfile mode keeps dockerfilePath, drops build/start commands', () => {
		const stored = buildStoredPublicRepoConfig(
			{ ...base, builder: 'dockerfile', dockerfilePath: 'docker/Dockerfile', buildCommand: 'npm run build', startCommand: 'node x.js' },
			[]
		);
		expect(stored.builder).toBe('dockerfile');
		expect(stored.dockerfilePath).toBe('docker/Dockerfile');
		expect('buildCommand' in stored).toBe(false);
		expect('startCommand' in stored).toBe(false);
	});

	test('dockerfile mode without a path omits dockerfilePath (worker defaults to Dockerfile)', () => {
		const stored = buildStoredPublicRepoConfig({ ...base, builder: 'dockerfile' }, []);
		expect(stored.builder).toBe('dockerfile');
		expect('dockerfilePath' in stored).toBe(false);
	});
});
