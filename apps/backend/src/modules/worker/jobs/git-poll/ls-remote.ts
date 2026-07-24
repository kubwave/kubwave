import { spawn } from 'node:child_process';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { prepareGitAuthEnv } from './git-auth.js';

// Resolve branch HEAD via git ls-remote; private repos auth with the team deploy key decrypted into a 0600 temp file, removed afterwards.

export interface ResolveHeadOptions {
	repoUrl: string;
	branch: string;
	// Present for private-repo services — the ssh_keys row id whose private half we decrypt.
	sshKeyId?: string | null;
	// Present for github-repo services — the git_installations row id whose short-lived token authenticates over HTTPS.
	installationId?: string | null;
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

// Branch HEAD SHA, or null if the branch is gone; throws on auth/network/timeout (caller records last_poll_error).
export async function resolveRemoteHead(opts: ResolveHeadOptions): Promise<string | null> {
	const auth = await prepareGitAuthEnv(opts);

	try {
		const wantedRef = toRemoteRef(opts.branch);
		const proc = spawn('git', ['ls-remote', opts.repoUrl, wantedRef], { env: auth.env });

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
		await auth.cleanup();
	}
}
