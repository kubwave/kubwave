import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, sshKeys } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { gitTokenAuthEnv } from '../../../git/git-clone-auth.js';

export type GitAuthOptions = {
	repoUrl: string;
	sshKeyId?: string | null;
	installationId?: string | null;
};

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

/** Build a git env (SSH key or installation token) and a cleanup that removes any temp key dir. */
export async function prepareGitAuthEnv(opts: GitAuthOptions): Promise<{
	env: Record<string, string>;
	cleanup: () => Promise<void>;
}> {
	const env: Record<string, string> = {
		...process.env,
		GIT_TERMINAL_PROMPT: '0'
	};
	let keyDir: string | undefined;
	const cleanup = async () => {
		if (keyDir) await rm(keyDir, { recursive: true, force: true }).catch(() => {});
	};

	try {
		if (opts.sshKeyId) {
			keyDir = await mkdtemp(join(tmpdir(), 'gitauth-'));
			const keyPath = join(keyDir, 'id');
			await writeFile(keyPath, await decryptDeployKey(opts.sshKeyId), { mode: 0o600 });
			env.GIT_SSH_COMMAND = sshCommand(keyPath);
		} else if (opts.installationId) {
			// Lazy import keeps the installation-token module out of the static graph for pure parse tests.
			const { getInstallationToken } = await import('../../../git/installation-token.js');
			Object.assign(env, gitTokenAuthEnv(opts.repoUrl, await getInstallationToken(opts.installationId)));
		}
		return { env, cleanup };
	} catch (err) {
		await cleanup();
		throw err;
	}
}
