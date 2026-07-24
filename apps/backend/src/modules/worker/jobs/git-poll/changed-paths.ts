import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { prepareGitAuthEnv } from './git-auth.js';
import { runGit } from './run-git.js';

export interface ListChangedPathsOptions {
	repoUrl: string;
	oldSha: string;
	newSha: string;
	sshKeyId?: string | null;
	installationId?: string | null;
	timeoutMs: number;
}

export function parseChangedPaths(stdout: string): string[] {
	return stdout
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);
}

// Files changed between two SHAs. Temp bare repo + blobless fetch keeps this cheaper than a full clone.
export async function listChangedPaths(opts: ListChangedPathsOptions): Promise<string[]> {
	let workDir: string | undefined;
	const auth = await prepareGitAuthEnv(opts);
	const deadline = Date.now() + opts.timeoutMs;
	const remainingMs = () => Math.max(1, deadline - Date.now());

	try {
		workDir = await mkdtemp(join(tmpdir(), 'gitdiff-'));
		await runGit(['init', '--bare'], { cwd: workDir, env: auth.env, timeoutMs: remainingMs() });
		await runGit(['remote', 'add', 'origin', opts.repoUrl], { cwd: workDir, env: auth.env, timeoutMs: remainingMs() });
		await runGit(['fetch', '--no-tags', '--filter=blob:none', 'origin', opts.oldSha, opts.newSha], {
			cwd: workDir,
			env: auth.env,
			timeoutMs: remainingMs()
		});
		const stdout = await runGit(['diff', '--name-only', opts.oldSha, opts.newSha], {
			cwd: workDir,
			env: auth.env,
			timeoutMs: remainingMs()
		});
		return parseChangedPaths(stdout);
	} catch (err) {
		throw new Error(errorMessage(err));
	} finally {
		if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
		await auth.cleanup();
	}
}
