import { describe, expect, test } from 'bun:test';
import { createServiceSchema, privateRepoConfigSchema } from '~/modules/services/services.dto';
import { buildStoredPrivateRepoConfig } from '~/modules/services/services.config';

const KEY_ID = '11111111-1111-4111-8111-111111111111';
const baseConfig = { repoUrl: 'git@github.com:org/repo.git', branch: 'main', sshKeyId: KEY_ID, containerPort: 3000, env: [] };

describe('privateRepoConfigSchema', () => {
	test('accepts a scp-style SSH URL with a deploy key', () => {
		expect(privateRepoConfigSchema.safeParse(baseConfig).success).toBe(true);
	});

	test('accepts an ssh:// URL', () => {
		expect(privateRepoConfigSchema.safeParse({ ...baseConfig, repoUrl: 'ssh://git@gitea.example/kintex/app.git' }).success).toBe(true);
	});

	test('accepts an ssh:// URL with a custom port', () => {
		expect(privateRepoConfigSchema.safeParse({ ...baseConfig, repoUrl: 'ssh://git@gitea.example:2222/kintex/app.git' }).success).toBe(true);
	});

	test('rejects an http(s) URL (that is the public-repo type)', () => {
		expect(privateRepoConfigSchema.safeParse({ ...baseConfig, repoUrl: 'https://github.com/org/repo' }).success).toBe(false);
	});

	test('rejects invalid ssh:// ports', () => {
		expect(privateRepoConfigSchema.safeParse({ ...baseConfig, repoUrl: 'ssh://git@gitea.example:/kintex/app.git' }).success).toBe(false);
		expect(privateRepoConfigSchema.safeParse({ ...baseConfig, repoUrl: 'ssh://git@gitea.example:99999/kintex/app.git' }).success).toBe(false);
	});

	test('requires a deploy key id', () => {
		const { sshKeyId, ...withoutKey } = baseConfig;
		void sshKeyId;
		expect(privateRepoConfigSchema.safeParse(withoutKey).success).toBe(false);
	});

	test('rejects a non-uuid deploy key id', () => {
		expect(privateRepoConfigSchema.safeParse({ ...baseConfig, sshKeyId: 'not-a-uuid' }).success).toBe(false);
	});

	test('defaults the branch to main when omitted', () => {
		const result = privateRepoConfigSchema.safeParse({ repoUrl: 'git@github.com:org/repo.git', sshKeyId: KEY_ID, containerPort: null, env: [] });
		expect(result.success).toBe(true);
		expect(result.success && result.data.branch).toBe('main');
	});

	test('still enforces the shared runtime rules (autoscaling + volume are exclusive)', () => {
		const result = privateRepoConfigSchema.safeParse({
			...baseConfig,
			resources: { cpuRequest: '250m' },
			volumes: [{ name: 'data', mountPath: '/data', size: '1Gi' }],
			autoscaling: { enabled: true, maxReplicas: 3, targetCpuUtilizationPercentage: 70 }
		});
		expect(result.success).toBe(false);
	});
});

describe('createServiceSchema (private-repo branch)', () => {
	test('a private-repo service validates against the private-repo config', () => {
		expect(createServiceSchema.safeParse({ name: 'web', type: 'private-repo', config: baseConfig }).success).toBe(true);
	});

	test('a private-repo service rejects a public-repo config (https + no key)', () => {
		const result = createServiceSchema.safeParse({
			name: 'web',
			type: 'private-repo',
			config: { repoUrl: 'https://github.com/org/repo', branch: 'main', containerPort: 80, env: [] }
		});
		expect(result.success).toBe(false);
	});
});

describe('buildStoredPrivateRepoConfig', () => {
	test('trims fields, keeps the key id, drops empty optionals', () => {
		const stored = buildStoredPrivateRepoConfig(
			{
				repoUrl: '  git@github.com:org/repo.git  ',
				branch: '  main  ',
				sshKeyId: `  ${KEY_ID}  `,
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
		expect(stored.repoUrl).toBe('git@github.com:org/repo.git');
		expect(stored.branch).toBe('main');
		expect(stored.sshKeyId).toBe(KEY_ID);
		expect('commit' in stored).toBe(false);
		expect('rootDirectory' in stored).toBe(false);
	});
});
