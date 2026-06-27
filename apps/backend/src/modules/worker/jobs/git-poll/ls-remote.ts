import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, sshKeys } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { errorMessage } from '../../../../shared/worker-common/errors.js';

// Resolve branch HEAD via git ls-remote; private repos auth with the team deploy key decrypted into a 0600 temp file, removed afterwards.

export interface ResolveHeadOptions {
	repoUrl: string;
	branch: string;
	// Present for private-repo services — the ssh_keys row id whose private half we decrypt.
	sshKeyId?: string | null;
	timeoutMs: number;
}

// Bare branch -> refs/heads/<branch>; an already-full ref (e.g. refs/pull/42/head) is used verbatim.
export function toRemoteRef(ref: string): string {
	return ref.startsWith('refs/') ? ref : `refs/heads/${ref}`;
}

// Parse git ls-remote output into a ref->sha map; skips peeled tags (^{}) and non-40-hex shas.
export function parseLsRemoteRefs(stdout: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const [sha, ref] = trimmed.split('\t');
		if (!sha || !ref || ref.endsWith('^{}')) continue;
		if (!/^[0-9a-f]{40}$/i.test(sha)) continue;
		map.set(ref, sha.toLowerCase());
	}
	return map;
}

// SHA for a single ref from ls-remote output, or null if absent (branch/ref deleted).
export function parseLsRemote(stdout: string, ref: string): string | null {
	const wanted = toRemoteRef(ref);
	return parseLsRemoteRefs(stdout).get(wanted) ?? null;
}

// BatchMode stops an interactive prompt from hanging the subprocess; accept-new + /dev/null known_hosts means host keys aren't pinned yet.
function sshCommand(keyPath: string): string {
	return `ssh -i ${keyPath} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
}

async function decryptDeployKey(sshKeyId: string): Promise<string> {
	const [row] = await db.select({ ciphertext: sshKeys.privateKeyCiphertext }).from(sshKeys).where(eq(sshKeys.id, sshKeyId)).limit(1);
	if (!row) throw new Error('Deploy key not found — it may have been deleted. Reattach a key in the service settings.');
	const key = decryptSecret(row.ciphertext);
	return key.endsWith('\n') ? key : `${key}\n`;
}

// Branch HEAD SHA, or null if the branch is gone; throws on auth/network/timeout (caller records last_poll_error).
export async function resolveRemoteHead(opts: ResolveHeadOptions): Promise<string | null> {
	let keyDir: string | undefined;
	const gitEnv: Record<string, string> = {
		...process.env,
		// Never let git prompt for credentials — a private HTTPS URL without auth must fail fast.
		GIT_TERMINAL_PROMPT: '0'
	};

	try {
		if (opts.sshKeyId) {
			keyDir = await mkdtemp(join(tmpdir(), 'gitpoll-'));
			const keyPath = join(keyDir, 'id');
			await writeFile(keyPath, await decryptDeployKey(opts.sshKeyId), { mode: 0o600 });
			gitEnv.GIT_SSH_COMMAND = sshCommand(keyPath);
		}

		const wantedRef = toRemoteRef(opts.branch);
		const proc = spawn('git', ['ls-remote', opts.repoUrl, wantedRef], { env: gitEnv });

		// Surface the timeout as an error: a signal-killed git otherwise looks like a clean empty exit, misread as "branch deleted".
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill();
		}, opts.timeoutMs);
		try {
			const { stdout, stderr, code, signal } = await new Promise<{
				stdout: string;
				stderr: string;
				code: number | null;
				signal: NodeJS.Signals | null;
			}>((resolve, reject) => {
				let stdout = '';
				let stderr = '';
				proc.stdout?.on('data', (chunk: Buffer) => {
					stdout += chunk.toString();
				});
				proc.stderr?.on('data', (chunk: Buffer) => {
					stderr += chunk.toString();
				});
				proc.on('error', reject);
				proc.on('close', (code, signal) => resolve({ stdout, stderr, code, signal }));
			});
			if (timedOut) throw new Error(`git ls-remote timed out after ${opts.timeoutMs}ms`);
			if (code !== 0) {
				const detail = stderr.trim() || stdout.trim() || `git exited ${code ?? `signal ${signal}`}`;
				throw new Error(`git ls-remote failed: ${detail}`);
			}
			return parseLsRemote(stdout, opts.branch);
		} finally {
			clearTimeout(timer);
		}
	} catch (err) {
		throw new Error(errorMessage(err));
	} finally {
		if (keyDir) await rm(keyDir, { recursive: true, force: true }).catch(() => {});
	}
}
