import { spawn, type ChildProcess } from 'node:child_process';

// Kill the whole process group (git + SSH children). Requires spawn({ detached: true }).
export function killGitProcessGroup(proc: ChildProcess): NodeJS.Timeout | undefined {
	const pid = proc.pid;
	if (pid == null) return undefined;
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			proc.kill('SIGTERM');
		} catch {
			// already exited
		}
	}
	return setTimeout(() => {
		try {
			process.kill(-pid, 'SIGKILL');
		} catch {
			try {
				proc.kill('SIGKILL');
			} catch {
				// already exited
			}
		}
	}, 5_000).unref();
}

export async function runGit(args: string[], opts: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<string> {
	const proc = spawn('git', args, { cwd: opts.cwd, env: opts.env, detached: true });
	let timedOut = false;
	let killFallbackTimer: NodeJS.Timeout | undefined;
	const timer = setTimeout(() => {
		timedOut = true;
		killFallbackTimer = killGitProcessGroup(proc);
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
		if (timedOut) throw new Error(`git ${args[0]} timed out after ${opts.timeoutMs}ms`);
		if (code !== 0) {
			const detail = stderr.trim() || stdout.trim() || `git exited ${code ?? `signal ${signal}`}`;
			throw new Error(`git ${args.join(' ')} failed: ${detail}`);
		}
		return stdout;
	} finally {
		clearTimeout(timer);
		if (killFallbackTimer) clearTimeout(killFallbackTimer);
	}
}
