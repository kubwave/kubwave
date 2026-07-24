import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

let lastSpawns: Array<{ args: string[]; cwd?: string }> = [];
let spawnResults: Array<{ stdout?: string; stderr?: string; exitCode?: number }> = [];
let spawnIdx = 0;

mock.module('node:child_process', () => ({
	spawn: (command: string, args: string[], opts: { cwd?: string; env: Record<string, string> }) => {
		lastSpawns.push({ args: [command, ...args], cwd: opts.cwd });
		const result = spawnResults[spawnIdx++] ?? { exitCode: 0 };
		const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
		proc.stdout = new EventEmitter();
		proc.stderr = new EventEmitter();
		proc.kill = () => {};
		queueMicrotask(() => {
			if (result.stdout) proc.stdout.emit('data', Buffer.from(result.stdout));
			if (result.stderr) proc.stderr.emit('data', Buffer.from(result.stderr));
			proc.emit('close', result.exitCode ?? 0, null);
		});
		return proc;
	}
}));

mock.module('@kubwave/db', () => ({
	sshKeys: { id: 'id', privateKeyCiphertext: 'pk' },
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })
	}
}));
mock.module('node:fs/promises', () => ({
	mkdtemp: async (prefix: string) => `${prefix}XXXX`,
	writeFile: async () => {},
	rm: async () => {}
}));

const { parseChangedPaths, listChangedPaths } = await import('~/modules/worker/jobs/git-poll/changed-paths');

afterEach(() => {
	lastSpawns = [];
	spawnResults = [];
	spawnIdx = 0;
});

describe('parseChangedPaths', () => {
	it('splits non-empty lines', () => {
		expect(parseChangedPaths('apps/web/a.ts\n\npackages/db/b.ts\n')).toEqual(['apps/web/a.ts', 'packages/db/b.ts']);
	});
});

describe('listChangedPaths', () => {
	it('fetches both SHAs and diffs name-only', async () => {
		spawnResults = [
			{ exitCode: 0 }, // init
			{ exitCode: 0 }, // remote add
			{ exitCode: 0 }, // fetch
			{ stdout: 'apps/web/index.ts\nREADME.md\n', exitCode: 0 } // diff
		];
		const files = await listChangedPaths({
			repoUrl: 'https://github.com/x/y.git',
			oldSha: 'a'.repeat(40),
			newSha: 'b'.repeat(40),
			timeoutMs: 5_000
		});
		expect(files).toEqual(['apps/web/index.ts', 'README.md']);
		expect(lastSpawns.map(s => s.args.slice(1))).toEqual([
			['init', '--bare'],
			['remote', 'add', 'origin', 'https://github.com/x/y.git'],
			['fetch', '--no-tags', '--filter=blob:none', 'origin', 'a'.repeat(40), 'b'.repeat(40)],
			['diff', '--name-only', 'a'.repeat(40), 'b'.repeat(40)]
		]);
	});

	it('throws when a git step fails', async () => {
		spawnResults = [{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 1, stderr: 'fetch failed' }];
		await expect(
			listChangedPaths({
				repoUrl: 'https://github.com/x/y.git',
				oldSha: 'a'.repeat(40),
				newSha: 'b'.repeat(40),
				timeoutMs: 5_000
			})
		).rejects.toThrow(/fetch failed/);
	});
});
