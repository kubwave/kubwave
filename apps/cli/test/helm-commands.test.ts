import { afterEach, describe, expect, mock, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HelmCommandError } from '../src/lib/errors.js';
import { execHelm, generateValuesFile, helmUninstall, helmUpgradeInstall, listReleaseNames } from '../src/lib/helm.js';

const realSpawn = Bun.spawn;
const cleanups: string[] = [];
let spawnCalls: string[][] = [];

afterEach(() => {
	Bun.spawn = realSpawn;
	delete process.env.KUBWAVE_HELM_BIN;
	delete process.env.KUBWAVE_INSTALL_TIMEOUT;
	for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
	spawnCalls = [];
});

describe('helm command execution', () => {
	test('executes helm and captures stdout, stderr, and exit code', async () => {
		useTempHelm();
		stubSpawn([{ stdout: 'ok', stderr: 'warn', exitCode: 4 }]);

		await expect(execHelm(['version'])).resolves.toEqual({ stdout: 'ok', stderr: 'warn', exitCode: 4 });
		expect(spawnCalls[0]!.slice(1)).toEqual(['version']);
	});

	test('describes synchronous spawn failures as a failed result (does not throw)', async () => {
		useTempHelm();
		// Bun.spawn throws synchronously when the OS refuses to exec helm (e.g. EACCES under the
		// update Job's securityContext); execHelm must return a non-zero result, NOT throw, so
		// best-effort readers degrade to {} instead of aborting the phase.
		const cases: Array<[string, string]> = [
			['EACCES', 'permission denied'],
			['ENOEXEC', 'exec format error'],
			['ENOENT', 'no such file'],
			['OTHER', 'broken']
		];
		for (const [code, message] of cases) {
			Bun.spawn = mock(() => {
				throw Object.assign(new Error('broken'), { code });
			}) as never;

			const result = await execHelm(['version']);
			expect(result.exitCode).toBe(126);
			expect(result.stdout).toBe('');
			expect(result.stderr).toContain(message);
		}
	});

	test('writes generated values to a temporary YAML file', () => {
		const path = generateValuesFile({
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '1.2.3',
			imageRegistry: 'ghcr.io/test',
			namespace: 'kubwave',
			ha: false
		});

		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, 'utf8')).toContain('APP_BASE_URL: https://app.example.com');
	});

	test('maps uninstall success, missing release, and helm errors', async () => {
		useTempHelm();
		stubSpawn([
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: 'release: not found', stderr: '', exitCode: 1 },
			{ stdout: '', stderr: 'permission denied', exitCode: 2 }
		]);

		await expect(helmUninstall('kubwave', 'kubwave')).resolves.toEqual({ removed: true });
		await expect(helmUninstall('missing', 'kubwave')).resolves.toEqual({ removed: false });
		await expect(helmUninstall('bad', 'kubwave')).rejects.toBeInstanceOf(HelmCommandError);
	});

	test('runs helm upgrade install and throws on non-zero exit', async () => {
		useTempHelm();
		stubSpawn([
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: 'upgrade failed', exitCode: 1 }
		]);
		const config = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '1.2.3',
			imageRegistry: 'ghcr.io/test',
			namespace: 'custom',
			ha: false
		};

		await expect(helmUpgradeInstall(config, '/tmp/values.yaml')).resolves.toBeUndefined();
		expect(spawnCalls[0]).toContain('--create-namespace');
		expect(spawnCalls[0]).toContain('custom');
		await expect(helmUpgradeInstall(config, '/tmp/values.yaml')).rejects.toBeInstanceOf(HelmCommandError);
	});

	test('waits long enough for a cold first install that bootstraps the database (default 10m)', async () => {
		useTempHelm();
		stubSpawn([{ stdout: '', stderr: '', exitCode: 0 }]);
		const config = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '1.2.3',
			imageRegistry: 'ghcr.io/test',
			namespace: 'kubwave',
			ha: false
		};

		await helmUpgradeInstall(config, '/tmp/values.yaml');

		const args = spawnCalls[0]!;
		expect(args).toContain('--wait');
		const idx = args.indexOf('--timeout');
		expect(idx).toBeGreaterThanOrEqual(0);
		expect(args[idx + 1]).toBe('10m');
	});

	test('listReleaseNames returns parsed names on success', async () => {
		useTempHelm();
		stubSpawn([{ stdout: 'release1\nrelease2\n\n', stderr: '', exitCode: 0 }]);

		const names = await listReleaseNames('kubwave');
		expect(names).toEqual(['release1', 'release2']);
		expect(spawnCalls[0]).toEqual(expect.arrayContaining(['list', '-n', 'kubwave', '-q']));
	});

	test('listReleaseNames returns empty array on non-zero exit', async () => {
		useTempHelm();
		stubSpawn([{ stdout: '', stderr: 'error', exitCode: 1 }]);

		const names = await listReleaseNames('missing-ns');
		expect(names).toEqual([]);
	});

	test('listReleaseNames handles empty stdout', async () => {
		useTempHelm();
		stubSpawn([{ stdout: '', stderr: '', exitCode: 0 }]);

		const names = await listReleaseNames('empty');
		expect(names).toEqual([]);
	});

	test('honors KUBWAVE_INSTALL_TIMEOUT override for slow clusters', async () => {
		useTempHelm();
		process.env.KUBWAVE_INSTALL_TIMEOUT = '20m';
		stubSpawn([{ stdout: '', stderr: '', exitCode: 0 }]);
		const config = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '1.2.3',
			imageRegistry: 'ghcr.io/test',
			namespace: 'kubwave',
			ha: false
		};

		await helmUpgradeInstall(config, '/tmp/values.yaml');

		const args = spawnCalls[0]!;
		const idx = args.indexOf('--timeout');
		expect(args[idx + 1]).toBe('20m');
	});
});

function useTempHelm(): string {
	const dir = mkdtempSync(join(tmpdir(), 'kubwave-helm-bin-'));
	const helm = join(dir, 'helm');
	writeFileSync(helm, '#!/bin/sh\n');
	chmodSync(helm, 0o755);
	process.env.KUBWAVE_HELM_BIN = helm;
	cleanups.push(dir);
	return helm;
}

function stubSpawn(results: Array<{ stdout: string; stderr: string; exitCode: number }>) {
	Bun.spawn = mock((cmd: string[]) => {
		spawnCalls.push(cmd);
		const result = results.shift() ?? { stdout: '', stderr: '', exitCode: 0 };
		return {
			stdout: new Response(result.stdout).body,
			stderr: new Response(result.stderr).body,
			exited: Promise.resolve(result.exitCode)
		};
	}) as never;
}
