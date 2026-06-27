import * as p from '@clack/prompts';
import { resolveChannel, type Channel } from '~/lib/channel.js';
import { isDevBuild } from '~/lib/cli-version.js';
import { StdoutReporter, type ProgressReporter } from '~/lib/progress.js';
import { platformAssetName, resolveLatestRelease, type ReleaseInfo } from '~/lib/releases.js';
import { describeRefresh, refreshAndReExec, type SelfRefreshDecision } from '~/lib/self-refresh.js';

export const SELF_REFRESHED_ENV = 'KUBWAVE_SELF_REFRESHED';

type ConfirmFn = (message: string) => Promise<boolean | symbol>;

export interface StartupSelfUpdateOptions {
	commandName: string;
	argv?: string[];
	env?: Record<string, string | undefined>;
	currentVersion?: string;
	stdinIsTTY?: boolean;
	stdoutIsTTY?: boolean;
	reporter?: ProgressReporter;
	resolveLatest?: (channel: Channel) => Promise<ReleaseInfo>;
	describe?: (targetVersion: string) => SelfRefreshDecision;
	getAssetName?: () => string;
	confirm?: ConfirmFn;
	refresh?: (opts: {
		release: ReleaseInfo;
		reporter: ProgressReporter;
		forwardArgs: string[];
		env?: Record<string, string | undefined>;
	}) => Promise<never>;
}

export async function maybeRunStartupSelfUpdate(opts: StartupSelfUpdateOptions): Promise<void> {
	const env = opts.env ?? process.env;
	if (shouldSkipStartupSelfUpdate(opts.commandName, env, opts.currentVersion)) return;

	const reporter = opts.reporter ?? new StdoutReporter();
	const resolveLatest = opts.resolveLatest ?? resolveLatestRelease;
	const describe = opts.describe ?? describeRefresh;
	const getAssetName = opts.getAssetName ?? platformAssetName;
	const refresh = opts.refresh ?? refreshAndReExec;

	let release: ReleaseInfo;
	try {
		release = await resolveLatest(startupChannel(env));
	} catch (err) {
		reporter.log(`CLI update check skipped: ${errorMessage(err)}`);
		return;
	}

	const decision = describe(release.version);
	if (!decision.needed) return;

	let assetName: string;
	try {
		assetName = getAssetName();
	} catch (err) {
		reporter.log(`CLI update check skipped: ${errorMessage(err)}`);
		return;
	}

	if (!release.assets.some(asset => asset.name === assetName)) {
		reporter.log(`New CLI ${release.tag} is available, but no ${assetName} asset was published.`);
		return;
	}

	const message = `New kubwave CLI available: v${decision.current} -> v${decision.target}. Update now?`;
	if (!isInteractive(opts, env)) {
		reporter.log(`${message} Run kubwave update to refresh the local binary.`);
		return;
	}

	const confirm = opts.confirm ?? (question => p.confirm({ message: question, initialValue: true }));
	const answer = await confirm(message);
	if (p.isCancel(answer) || answer !== true) return;

	await refresh({
		release,
		reporter,
		forwardArgs: opts.argv ?? process.argv.slice(2),
		env: { [SELF_REFRESHED_ENV]: '1' }
	});
}

export function shouldSkipStartupSelfUpdate(
	commandName: string,
	env: Record<string, string | undefined> = process.env,
	currentVersion?: string
): boolean {
	if (currentVersion !== undefined ? currentVersion === 'dev' : isDevBuild()) return true;
	if (env[SELF_REFRESHED_ENV] === '1') return true;
	return commandName === 'update' || commandName === 'version';
}

function startupChannel(env: Record<string, string | undefined>): Channel {
	return resolveChannel({ override: env['KUBWAVE_CHANNEL'] || undefined });
}

function isInteractive(opts: StartupSelfUpdateOptions, env: Record<string, string | undefined>): boolean {
	if (env['CI']) return false;
	return (opts.stdinIsTTY ?? process.stdin.isTTY) === true && (opts.stdoutIsTTY ?? process.stdout.isTTY) === true;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
