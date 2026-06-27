import { afterEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { platformAssetName, type ReleaseInfo } from '../src/lib/releases.js';
import { describeRefresh, refreshAndReExec } from '../src/lib/self-refresh.js';

const realFetch = globalThis.fetch;
const realSpawnSync = Bun.spawnSync;
const realExit = process.exit;

afterEach(() => {
	globalThis.fetch = realFetch;
	Bun.spawnSync = realSpawnSync;
	(process as unknown as { exit: typeof process.exit }).exit = realExit;
});

function stubFetch(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch {
	return Object.assign(fn, { preconnect: realFetch.preconnect }) as typeof fetch;
}

describe('self refresh decision', () => {
	test('skips self-refresh for dev builds', () => {
		expect(describeRefresh('1.2.3')).toEqual({
			current: 'dev',
			target: '1.2.3',
			needed: false,
			reason: 'dev build — self-refresh skipped'
		});
	});

	test('downloads, swaps, and re-execs a refreshed binary', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'kubwave-refresh-'));
		const binaryPath = join(dir, 'kubwave');
		writeFileSync(binaryPath, 'old');
		globalThis.fetch = stubFetch(async () => new Response('new binary', { status: 200 }));
		const spawnCalls: Array<{ cmd: string[]; env?: Record<string, string | undefined> }> = [];
		Bun.spawnSync = mock((cmd: string[], opts: { env?: Record<string, string | undefined> }) => {
			spawnCalls.push({ cmd, env: opts.env });
			return { exitCode: 12 } as never;
		}) as never;
		(process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
			throw new ExitSignal(code);
		}) as never;
		const reporter = recordingReporter();

		try {
			await refreshAndReExec({
				release: releaseInfo(),
				reporter,
				forwardArgs: ['status', '--json'],
				env: { SELF_REFRESHED: '1' },
				binaryPath
			});
			throw new Error('refreshAndReExec should exit');
		} catch (err) {
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(12);

			expect(readFileSync(binaryPath, 'utf8')).toBe('new binary');
			expect(spawnCalls[0]!.cmd).toEqual([binaryPath, 'status', '--json']);
			expect(spawnCalls[0]!.env?.SELF_REFRESHED).toBe('1');
			expect(reporter.events).toContain(`succeed:Downloaded ${platformAssetName()}`);
			expect(reporter.events).toContain('succeed:CLI binary refreshed');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('cleans up a failed refresh download', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'kubwave-refresh-fail-'));
		const binaryPath = join(dir, 'kubwave');
		const tmpPath = join(dir, `.kubwave.new-${process.pid}`);
		writeFileSync(binaryPath, 'old');
		globalThis.fetch = stubFetch(async () => new Response('', { status: 500, statusText: 'Server Error' }));

		try {
			await expect(
				refreshAndReExec({
					release: releaseInfo(),
					reporter: recordingReporter(),
					forwardArgs: [],
					binaryPath
				})
			).rejects.toThrow('Asset download failed: 500 Server Error');
			expect(existsSync(tmpPath)).toBe(false);
			expect(readFileSync(binaryPath, 'utf8')).toBe('old');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

function releaseInfo(): ReleaseInfo {
	return {
		tag: 'v1.2.3',
		version: '1.2.3',
		prerelease: false,
		assets: [{ name: platformAssetName(), size: 10, downloadUrl: 'https://api.github.com/repos/kubwave/kubwave/releases/assets/123' }]
	};
}

function recordingReporter() {
	const events: string[] = [];
	return {
		events,
		start: (phase: string) => events.push(`start:${phase}`),
		succeed: (phase: string) => events.push(`succeed:${phase}`),
		fail: (phase: string, error: string) => events.push(`fail:${phase}:${error}`),
		log: (message: string) => events.push(`log:${message}`),
		finish: (status: string, message: string) => {
			events.push(`finish:${status}:${message}`);
		}
	};
}

class ExitSignal extends Error {
	code?: number;

	constructor(code?: number) {
		super(`exit ${code}`);
		this.code = code;
	}
}
