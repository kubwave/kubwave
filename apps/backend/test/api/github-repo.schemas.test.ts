import { describe, expect, test } from 'bun:test';
import { createServiceSchema, githubRepoConfigSchema, updateServiceSchema } from '~/modules/services/services.dto';
import { buildStoredGithubRepoConfig } from '~/modules/services/services.config';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const baseConfig = { repoFullName: 'org/repo', installationId: INSTALLATION_ID, branch: 'main', containerPort: 3000, env: [] };

describe('githubRepoConfigSchema', () => {
	test('accepts a repoFullName + installation, no client repoUrl', () => {
		expect(githubRepoConfigSchema.safeParse(baseConfig).success).toBe(true);
	});

	test('requires a uuid installation id', () => {
		expect(githubRepoConfigSchema.safeParse({ ...baseConfig, installationId: 'not-a-uuid' }).success).toBe(false);
		const { installationId, ...withoutInstall } = baseConfig;
		void installationId;
		expect(githubRepoConfigSchema.safeParse(withoutInstall).success).toBe(false);
	});

	test('rejects a repoFullName that is not owner/repo or traverses', () => {
		expect(githubRepoConfigSchema.safeParse({ ...baseConfig, repoFullName: 'justrepo' }).success).toBe(false);
		expect(githubRepoConfigSchema.safeParse({ ...baseConfig, repoFullName: '../evil/repo' }).success).toBe(false);
	});

	test('defaults the branch to main when omitted', () => {
		const result = githubRepoConfigSchema.safeParse({ repoFullName: 'org/repo', installationId: INSTALLATION_ID, containerPort: null, env: [] });
		expect(result.success).toBe(true);
		expect(result.success && result.data.branch).toBe('main');
	});

	test('still enforces the shared runtime rules (autoscaling + volume are exclusive)', () => {
		const result = githubRepoConfigSchema.safeParse({
			...baseConfig,
			volumes: [{ name: 'data', mountPath: '/data', size: '1Gi' }],
			autoscaling: { enabled: true, maxReplicas: 3, targetCpuUtilizationPercentage: 70 }
		});
		expect(result.success).toBe(false);
	});
});

describe('createServiceSchema / updateServiceSchema (github-repo branch)', () => {
	test('a github-repo service validates against the github-repo config', () => {
		expect(createServiceSchema.safeParse({ name: 'web', type: 'github-repo', config: baseConfig }).success).toBe(true);
	});

	test('the update union accepts a github-repo config', () => {
		expect(updateServiceSchema.safeParse({ config: baseConfig }).success).toBe(true);
	});
});

describe('buildStoredGithubRepoConfig', () => {
	test('derives the canonical clone URL from repoFullName and keeps the installation', () => {
		const parsed = githubRepoConfigSchema.parse(baseConfig);
		const stored = buildStoredGithubRepoConfig(parsed, []);
		expect(stored.repoUrl).toBe('https://github.com/org/repo.git');
		expect(stored.repoFullName).toBe('org/repo');
		expect(stored.installationId).toBe(INSTALLATION_ID);
		expect(stored.branch).toBe('main');
	});
});
