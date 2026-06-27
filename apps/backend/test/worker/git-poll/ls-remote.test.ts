import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

// resolveRemoteHead shells out to git ls-remote; private repos decrypt the deploy key into a 0600 temp file.

let sshKeyRows: unknown[] = [];
const fsCalls: { writes: Array<{ path: string; data: string; mode?: number }>; mkdtemp: number; rm: number } = {
	writes: [],
	mkdtemp: 0,
	rm: 0
};

let lastSpawn: { args: string[]; env: Record<string, string> } | null = null;
let spawnResult: { stdout?: string; stderr?: string; exitCode?: number } = {};

// spawn mock emits spawnResult on the next microtask, after the SUT attaches its stdout/stderr/close listeners.
mock.module('node:child_process', () => ({
	spawn: (command: string, args: string[], opts: { env: Record<string, string> }) => {
		lastSpawn = { args: [command, ...args], env: opts.env };
		const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
		proc.stdout = new EventEmitter();
		proc.stderr = new EventEmitter();
		proc.kill = () => {};
		queueMicrotask(() => {
			if (spawnResult.stdout) proc.stdout.emit('data', Buffer.from(spawnResult.stdout));
			if (spawnResult.stderr) proc.stderr.emit('data', Buffer.from(spawnResult.stderr));
			proc.emit('close', spawnResult.exitCode ?? 0, null);
		});
		return proc;
	}
}));

mock.module('@kubwave/db', () => ({
	sshKeys: { id: 'id', privateKeyCiphertext: 'pk' },
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: async () => sshKeyRows }) }) })
	}
}));
mock.module('@kubwave/crypto', () => ({ decryptSecret: (s: string) => `DECRYPTED(${s})` }));
mock.module('node:fs/promises', () => ({
	mkdtemp: async (prefix: string) => {
		fsCalls.mkdtemp++;
		return `${prefix}XXXX`;
	},
	writeFile: async (path: string, data: string, opts?: { mode?: number }) => {
		fsCalls.writes.push({ path, data, mode: opts?.mode });
	},
	rm: async () => {
		fsCalls.rm++;
	}
}));

const { parseLsRemote, parseLsRemoteRefs, toRemoteRef, resolveRemoteHead } = await import('~/modules/worker/jobs/git-poll/ls-remote');

function stubSpawn(out: { stdout?: string; stderr?: string; exitCode?: number }): void {
	spawnResult = out;
}

afterEach(() => {
	lastSpawn = null;
	spawnResult = {};
	sshKeyRows = [];
	fsCalls.writes = [];
	fsCalls.mkdtemp = 0;
	fsCalls.rm = 0;
});

describe('toRemoteRef', () => {
	it('wraps a plain branch in refs/heads/', () => {
		expect(toRemoteRef('main')).toBe('refs/heads/main');
	});
	it('passes a full ref through unchanged', () => {
		expect(toRemoteRef('refs/pull/42/head')).toBe('refs/pull/42/head');
	});
});

describe('parseLsRemote (single ref)', () => {
	const out = '1111111111111111111111111111111111111111\trefs/heads/main\n2222222222222222222222222222222222222222\trefs/pull/42/head\n';
	it('resolves a plain branch', () => {
		expect(parseLsRemote(out, 'main')).toBe('1111111111111111111111111111111111111111');
	});
	it('resolves a full ref', () => {
		expect(parseLsRemote(out, 'refs/pull/42/head')).toBe('2222222222222222222222222222222222222222');
	});
	it('returns null when absent', () => {
		expect(parseLsRemote(out, 'nope')).toBeNull();
	});
});

describe('parseLsRemoteRefs (map)', () => {
	it('maps every ref to its sha, lowercased', () => {
		const out = 'AAAA000000000000000000000000000000000000\trefs/pull/1/head\nbbbb000000000000000000000000000000000000\trefs/pull/2/head\n';
		const map = parseLsRemoteRefs(out);
		expect(map.get('refs/pull/1/head')).toBe('aaaa000000000000000000000000000000000000');
		expect(map.get('refs/pull/2/head')).toBe('bbbb000000000000000000000000000000000000');
		expect(map.size).toBe(2);
	});
	it('ignores peeled tag lines (^{}) and malformed shas', () => {
		const out =
			'cccc000000000000000000000000000000000000\trefs/pull/3/head\ndddd000000000000000000000000000000000000\trefs/pull/3/head^{}\nshort\trefs/pull/4/head\n';
		const map = parseLsRemoteRefs(out);
		expect(map.get('refs/pull/3/head')).toBe('cccc000000000000000000000000000000000000');
		expect(map.has('refs/pull/3/head^{}')).toBe(false);
		expect(map.has('refs/pull/4/head')).toBe(false);
	});
});

describe('resolveRemoteHead (public)', () => {
	const sha = 'a'.repeat(40);

	it('runs git ls-remote for the wanted ref and returns the branch HEAD', async () => {
		stubSpawn({ stdout: `${sha}\trefs/heads/main\n`, exitCode: 0 });
		const head = await resolveRemoteHead({ repoUrl: 'https://x/r.git', branch: 'main', timeoutMs: 1000 });
		expect(head).toBe(sha);
		expect(lastSpawn!.args).toEqual(['git', 'ls-remote', 'https://x/r.git', 'refs/heads/main']);
		// no deploy key → never touch the filesystem.
		expect(fsCalls.mkdtemp).toBe(0);
		expect(fsCalls.writes).toHaveLength(0);
		// GIT_TERMINAL_PROMPT=0 disables interactive credential prompts.
		expect(lastSpawn!.env.GIT_TERMINAL_PROMPT).toBe('0');
		expect(lastSpawn!.env.GIT_SSH_COMMAND).toBeUndefined();
	});

	it('returns null when the branch is gone (no matching ref in output)', async () => {
		stubSpawn({ stdout: `${sha}\trefs/heads/other\n`, exitCode: 0 });
		const head = await resolveRemoteHead({ repoUrl: 'https://x/r.git', branch: 'main', timeoutMs: 1000 });
		expect(head).toBeNull();
	});

	it('throws with the stderr detail on a non-zero git exit', async () => {
		stubSpawn({ stdout: '', stderr: 'fatal: repository not found', exitCode: 128 });
		await expect(resolveRemoteHead({ repoUrl: 'https://x/r.git', branch: 'main', timeoutMs: 1000 })).rejects.toThrow(
			'git ls-remote failed: fatal: repository not found'
		);
	});

	it('falls back to a generic message when git prints nothing on failure', async () => {
		stubSpawn({ stdout: '', stderr: '', exitCode: 1 });
		await expect(resolveRemoteHead({ repoUrl: 'https://x/r.git', branch: 'main', timeoutMs: 1000 })).rejects.toThrow('git exited 1');
	});
});

describe('resolveRemoteHead (private, deploy key)', () => {
	const sha = 'b'.repeat(40);

	it('decrypts the deploy key into a 0600 file, sets GIT_SSH_COMMAND, and cleans up', async () => {
		sshKeyRows = [{ ciphertext: 'CIPHER' }];
		stubSpawn({ stdout: `${sha}\trefs/heads/main\n`, exitCode: 0 });
		const head = await resolveRemoteHead({ repoUrl: 'git@x:o/r.git', branch: 'main', sshKeyId: 'key-1', timeoutMs: 1000 });
		expect(head).toBe(sha);
		expect(fsCalls.mkdtemp).toBe(1);
		expect(fsCalls.writes).toHaveLength(1);
		expect(fsCalls.writes[0]!.mode).toBe(0o600);
		expect(fsCalls.writes[0]!.data).toBe('DECRYPTED(CIPHER)\n');
		// GIT_SSH_COMMAND points git at the written key with BatchMode (no interactive prompt).
		expect(lastSpawn!.env.GIT_SSH_COMMAND).toContain('ssh -i ');
		expect(lastSpawn!.env.GIT_SSH_COMMAND).toContain('BatchMode=yes');
		expect(fsCalls.rm).toBe(1);
	});

	it('does not append a second newline when the decrypted key already ends in one', async () => {
		sshKeyRows = [{ ciphertext: 'CIPHER' }];
		mock.module('@kubwave/crypto', () => ({ decryptSecret: () => 'KEY\n' }));
		const fresh = await import('~/modules/worker/jobs/git-poll/ls-remote');
		stubSpawn({ stdout: `${sha}\trefs/heads/main\n`, exitCode: 0 });
		await fresh.resolveRemoteHead({ repoUrl: 'git@x:o/r.git', branch: 'main', sshKeyId: 'key-1', timeoutMs: 1000 });
		expect(fsCalls.writes[0]!.data).toBe('KEY\n');
		mock.module('@kubwave/crypto', () => ({ decryptSecret: (s: string) => `DECRYPTED(${s})` }));
	});

	it('throws (and still cleans up) when the deploy key row is missing', async () => {
		sshKeyRows = []; // key deleted
		stubSpawn({ stdout: '', exitCode: 0 });
		await expect(resolveRemoteHead({ repoUrl: 'git@x:o/r.git', branch: 'main', sshKeyId: 'gone', timeoutMs: 1000 })).rejects.toThrow(
			'Deploy key not found'
		);
		expect(fsCalls.rm).toBe(1); // temp dir cleaned in the finally
	});
});
