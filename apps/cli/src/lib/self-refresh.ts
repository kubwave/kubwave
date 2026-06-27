import { chmodSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getCliVersion, isDevBuild } from '~/lib/cli-version.js';
import { downloadAsset, platformAssetName, type ReleaseInfo } from '~/lib/releases.js';
import type { ProgressReporter } from '~/lib/progress.js';

export interface SelfRefreshOpts {
	release: ReleaseInfo;
	reporter: ProgressReporter;
	forwardArgs: string[];
	env?: Record<string, string | undefined>;
	binaryPath?: string;
}

export interface SelfRefreshDecision {
	current: string;
	target: string;
	needed: boolean;
	reason?: string;
}

export function describeRefresh(targetVersion: string): SelfRefreshDecision {
	const current = getCliVersion();
	if (isDevBuild()) {
		return { current, target: targetVersion, needed: false, reason: 'dev build — self-refresh skipped' };
	}
	if (current === targetVersion) {
		return { current, target: targetVersion, needed: false, reason: 'already on target version' };
	}
	return { current, target: targetVersion, needed: true };
}

export async function refreshAndReExec(opts: SelfRefreshOpts): Promise<never> {
	const binaryPath = opts.binaryPath ?? process.execPath;
	const dir = dirname(binaryPath);
	const tmpPath = resolve(dir, `.kubwave.new-${process.pid}`);
	const assetName = platformAssetName();

	opts.reporter.start(`Downloading ${assetName} for ${opts.release.tag}…`);
	try {
		await downloadAsset(opts.release, assetName, tmpPath);
	} catch (err) {
		try {
			unlinkSync(tmpPath);
		} catch {
			// nothing to clean
		}
		throw err;
	}
	chmodSync(tmpPath, 0o755);
	opts.reporter.succeed(`Downloaded ${assetName}`);

	opts.reporter.start(`Swapping CLI binary at ${binaryPath}…`);
	renameSync(tmpPath, binaryPath);
	opts.reporter.succeed('CLI binary refreshed');

	opts.reporter.log(`↻ Re-running: kubwave ${opts.forwardArgs.join(' ')}`);

	const child = Bun.spawnSync([binaryPath, ...opts.forwardArgs], {
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env: { ...process.env, ...opts.env }
	});
	process.exit(child.exitCode ?? 1);
}
