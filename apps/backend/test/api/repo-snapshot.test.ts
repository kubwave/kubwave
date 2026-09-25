import { afterAll, describe, expect, mock, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

mock.module('@kubwave/db', () => ({ db: {}, sshKeys: {} }));

const { groupEnvKeys, parseEnvUsage, selectSnapshotFiles, snapshotRepo } = await import('~/modules/services/analyze/repo-snapshot');

const fixtureDir = mkdtempSync(join(tmpdir(), 'snapshot-fixture-'));

function git(...args: string[]): void {
	const result = spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args], { cwd: fixtureDir, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stderr);
}

function write(path: string, content: string): void {
	mkdirSync(dirname(join(fixtureDir, path)), { recursive: true });
	writeFileSync(join(fixtureDir, path), content);
}

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

describe('repo snapshot helpers', () => {
	test('selects manifests and env templates but never real env files', () => {
		const selected = selectSnapshotFiles([
			'apps/api/package.json',
			'package.json',
			'apps/api/.env',
			'apps/api/.env.local',
			'apps/api/.env.example',
			'apps/api/Dockerfile',
			'apps/api/src/index.ts',
			'certs/server.pem',
			'docker-compose.yml'
		]);
		expect(selected).toEqual(['docker-compose.yml', 'package.json', 'apps/api/.env.example', 'apps/api/Dockerfile', 'apps/api/package.json']);
	});

	test('groups env usages by the nearest project directory', () => {
		const usages = parseEnvUsage(
			[
				'FETCH_HEAD:apps/api/src/db.ts\0process.env.DATABASE_URL',
				'FETCH_HEAD:apps/api/src/app.ts\0process.env["JWT_SECRET',
				'FETCH_HEAD:apps/web/nuxt.config.ts\0import.meta.env.PUBLIC_API',
				'FETCH_HEAD:scripts/seed.py\0os.environ.get("SEED'
			].join('\n')
		);
		expect(groupEnvKeys(usages, new Set(['apps/api', 'apps/web']))).toEqual({
			'.': ['SEED'],
			'apps/api': ['DATABASE_URL', 'JWT_SECRET'],
			'apps/web': ['PUBLIC_API']
		});
	});
});

describe('snapshotRepo', () => {
	test('reads the tree, allowlisted files, and env keys without leaking env files', async () => {
		git('init', '-q', '-b', 'main');
		write('package.json', JSON.stringify({ name: 'shop', workspaces: ['apps/*'] }));
		write('apps/api/package.json', JSON.stringify({ name: 'api', scripts: { start: 'node dist/main.js' } }));
		write('apps/api/src/main.ts', 'const url = process.env.DATABASE_URL;\nconst key = process.env["JWT_SECRET"];\n');
		write('apps/api/.env', 'JWT_SECRET=super-secret-value\n');
		write('apps/api/.env.example', 'DATABASE_URL=\nJWT_SECRET=\n');
		write('apps/web/package.json', JSON.stringify({ name: 'web' }));
		write('apps/web/app.ts', 'fetch(import.meta.env.PUBLIC_API_URL);\n');
		write('node_modules/dep/package.json', '{}');
		git('add', '-A', '-f');
		git('commit', '-q', '-m', 'init');

		const snapshot = await snapshotRepo({ repoUrl: `file://${fixtureDir}`, branch: 'main', timeoutMs: 30_000 });

		expect(snapshot.paths).toContain('apps/api/src/main.ts');
		expect(snapshot.paths.some(path => path.startsWith('node_modules/'))).toBe(false);
		expect(snapshot.files.map(file => file.path)).toEqual([
			'package.json',
			'apps/api/.env.example',
			'apps/api/package.json',
			'apps/web/package.json'
		]);
		expect(JSON.stringify(snapshot)).not.toContain('super-secret-value');
		expect(snapshot.envKeys).toEqual({ 'apps/api': ['DATABASE_URL', 'JWT_SECRET'], 'apps/web': ['PUBLIC_API_URL'] });
	});
});
