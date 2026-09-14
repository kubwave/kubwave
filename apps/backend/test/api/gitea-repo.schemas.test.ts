import { describe, expect, test } from 'bun:test';
import { createServiceSchema, giteaRepoConfigSchema, updateServiceSchema } from '~/modules/services/services.dto';
import { buildStoredGiteaRepoConfig } from '~/modules/services/services.config';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const baseConfig = { repoFullName: 'org/repo', installationId: INSTALLATION_ID, branch: 'main', containerPort: 3000, env: [] };

describe('giteaRepoConfigSchema', () => {
	test('accepts a repoFullName + installation, no client repoUrl', () => {
		expect(giteaRepoConfigSchema.safeParse(baseConfig).success).toBe(true);
	});

	test('requires a uuid installation id', () => {
		expect(giteaRepoConfigSchema.safeParse({ ...baseConfig, installationId: 'not-a-uuid' }).success).toBe(false);
		const { installationId, ...withoutInstall } = baseConfig;
		void installationId;
		expect(giteaRepoConfigSchema.safeParse(withoutInstall).success).toBe(false);
	});

	test('rejects a repoFullName that is not owner/repo or traverses', () => {
		expect(giteaRepoConfigSchema.safeParse({ ...baseConfig, repoFullName: 'justrepo' }).success).toBe(false);
		expect(giteaRepoConfigSchema.safeParse({ ...baseConfig, repoFullName: '../evil/repo' }).success).toBe(false);
	});

	test('defaults the branch to main when omitted', () => {
		const result = giteaRepoConfigSchema.safeParse({ repoFullName: 'org/repo', installationId: INSTALLATION_ID, containerPort: null, env: [] });
		expect(result.success).toBe(true);
		expect(result.success && result.data.branch).toBe('main');
	});
});

describe('createServiceSchema / updateServiceSchema (gitea-repo branch)', () => {
	test('a gitea-repo service validates against the gitea-repo config', () => {
		expect(createServiceSchema.safeParse({ name: 'web', type: 'gitea-repo', config: baseConfig }).success).toBe(true);
	});

	test('the update union accepts a gitea-repo config and does not strip installation fields', () => {
		const result = updateServiceSchema.safeParse({ config: baseConfig });
		expect(result.success).toBe(true);
		expect(result.success && result.data.config && 'installationId' in result.data.config && result.data.config.installationId).toBe(INSTALLATION_ID);
		expect(result.success && result.data.config && 'repoFullName' in result.data.config && result.data.config.repoFullName).toBe('org/repo');
	});
});

describe('buildStoredGiteaRepoConfig', () => {
	test('derives the clone URL from the instance URL and keeps the installation', () => {
		const parsed = giteaRepoConfigSchema.parse(baseConfig);
		const stored = buildStoredGiteaRepoConfig(parsed, [], undefined, 'https://gitea.example');
		expect(stored.repoUrl).toBe('https://gitea.example/org/repo.git');
		expect(stored.repoFullName).toBe('org/repo');
		expect(stored.installationId).toBe(INSTALLATION_ID);
		expect(stored.branch).toBe('main');
	});
});
