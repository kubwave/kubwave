import type { Command } from 'commander';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import { buildRegistryEndpointHost } from '@kubwave/kube';
import { loadKubeConfig } from '~/lib/k8s.js';
import { confirmClusterContext } from '~/lib/context-confirm.js';
import { ensureDependencies, ensureDependenciesSilent, waitDependencies } from '~/lib/dependencies.js';
import { readVersionMarker, writeVersionMarker } from '~/lib/version-marker.js';
import { captureImageTags } from '~/lib/rollback.js';
import { execHelm } from '~/lib/helm.js';
import { getChartPath } from '~/lib/embedded.js';
import { createRegistrySecrets } from '~/lib/secrets.js';
import { StdoutReporter, DbReporter } from '~/lib/progress.js';
import type { ProgressReporter } from '~/lib/progress.js';
import { resolveChannel, type Channel } from '~/lib/channel.js';
import { resolveLatestRelease, getReleaseByTag, validateTargetForChannel, platformAssetName, type ReleaseInfo } from '~/lib/releases.js';
import { describeRefresh, refreshAndReExec } from '~/lib/self-refresh.js';
import { resolveInstallState, resolveInstalledDependencyState, type InstallState, type PartialInstallState } from '~/lib/install-state.js';
import { buildHelmUpgradeArgs, generateUpgradeValuesFile, writeUpgradeValuesFileTo } from '~/lib/upgrade-plan.js';
import { applyDesiredBuildRegistry, ensureDesiredBuildRegistrySecrets, readDesiredBuildRegistrySettings } from '~/lib/registry-settings.js';
import { FatalCliError, UserCancelledError, printAndExit } from '~/lib/errors.js';

export interface UpdateOpts {
	target?: string;
	channel?: string;
	registry?: string;
	inCluster: boolean;
	runId?: string;
	phase?: 'prepare' | 'repair-dependencies' | 'wait-dependencies' | 'helm-plan' | 'finalize';
	clusterConfirmed: boolean;
	skipSelfRefresh: boolean;
	yes: boolean;
}

// Shared work volume between in-cluster phases; matches the emptyDir mount in the update Job.
const IN_CLUSTER_WORK_DIR = '/tmp/work';

export function registerUpdateCommand(parent: Command): void {
	parent
		.command('update')
		.description(
			'Refreshes the local CLI binary (if newer) and upgrades the cluster installation. Resolves the target version from the active release channel unless --target is given.'
		)
		.option('--target <version>', 'Pin a specific version (e.g. v0.2.0). Default: latest from active channel.')
		.option('--channel <stable|preview>', 'One-shot override of the release channel; persisted to the cluster marker.')
		.option('--registry <url>', 'Container registry override')
		.option('--in-cluster', 'In-cluster mode (as a K8s Job)', false)
		.option('--run-id <id>', 'Update run ID (only with --in-cluster)')
		.option(
			'--phase <prepare|repair-dependencies|wait-dependencies|helm-plan|finalize>',
			'In-cluster phase, set by the update Job (only with --in-cluster)'
		)
		.option('--cluster-confirmed', 'Skip cluster confirmation', false)
		.option('--skip-self-refresh', 'Do not refresh the local CLI binary (internal: set after re-exec)', false)
		.option('--yes', 'Non-interactive: accept all prompts', false)
		.action(async (opts: UpdateOpts) => {
			try {
				if (opts.inCluster) {
					if (!opts.runId) {
						throw new FatalCliError('--run-id is required in --in-cluster mode');
					}
					if (
						opts.phase !== 'prepare' &&
						opts.phase !== 'repair-dependencies' &&
						opts.phase !== 'wait-dependencies' &&
						opts.phase !== 'helm-plan' &&
						opts.phase !== 'finalize'
					) {
						throw new FatalCliError(
							"--phase must be 'prepare', 'repair-dependencies', 'wait-dependencies', 'helm-plan', or 'finalize' in --in-cluster mode"
						);
					}
					const { updateRunStatus, setRunOldImageTags, closeDb } = await import('~/lib/db.js');
					const reporter: ProgressReporter = new DbReporter((status, phase, error) => updateRunStatus(opts.runId!, status, phase, error));

					try {
						if (opts.phase === 'prepare') {
							await runPrepare(opts, reporter, { setRunOldImageTags });
						} else if (opts.phase === 'repair-dependencies') {
							await runRepairDependencies(reporter);
						} else if (opts.phase === 'wait-dependencies') {
							await runWaitDependencies(reporter);
						} else if (opts.phase === 'helm-plan') {
							await runHelmPlanPhase(opts, reporter);
						} else {
							await runFinalize(opts, reporter);
						}
					} finally {
						await closeDb();
					}
				} else {
					p.intro('kubwave update');
					const reporter: ProgressReporter = new StdoutReporter();
					await runUpdate(opts, reporter);
					p.outro('Update complete');
				}
			} catch (err) {
				printAndExit(err);
			}
		});
}

export async function runUpdate(
	opts: UpdateOpts,
	reporter: ProgressReporter,
	dbOps?: {
		updateRunStatus: (runId: string, status: string, phase: string, error?: string) => Promise<void>;
		setRunOldImageTags: (runId: string, tags: Record<string, string>) => Promise<void>;
	}
): Promise<void> {
	reporter.start('Loading kubeconfig...');
	const kc = loadKubeConfig(opts.inCluster);
	reporter.succeed('Kubeconfig loaded');

	if (!opts.inCluster) {
		await confirmClusterContext(kc, opts.clusterConfirmed);
	}

	reporter.start('Reading current installation marker...');
	const marker = await readVersionMarker(kc);

	if (marker) {
		reporter.succeed(`Current: ${marker.currentVersion} (channel: ${marker.channel})`);
	} else {
		reporter.succeed('No previous installation marker found');
	}

	const channel = resolveChannel({ override: opts.channel, markerChannel: marker?.channel });

	if (marker && marker.channel !== channel) {
		reporter.log(`Switching channel: ${marker.channel} -> ${channel}`);

		if (!opts.inCluster && !opts.yes) {
			const ok = await p.confirm({ message: `Persist channel '${channel}' to the cluster marker?`, initialValue: true });

			if (p.isCancel(ok) || !ok) {
				reporter.fail('Channel switch', 'cancelled by user');
				reporter.finish('failed', 'Channel switch cancelled.');
				throw new UserCancelledError('Channel switch cancelled.');
			}
		}
	}

	reporter.start('Resolving target version...');
	const release = await resolveUpdateTarget(opts.target, channel, reporter);
	const targetVersion = release.version;
	const targetTag = release.tag;
	reporter.succeed(`Target: ${targetTag} (channel: ${channel})`);

	// Idempotency: legacy markers without installState still need one same-version pass so Web updates resolve registry/domain.
	const alreadyAtTarget = marker?.currentVersion === targetTag && marker.channel === channel;

	if (alreadyAtTarget && marker?.installState && !opts.registry) {
		reporter.log(`Already at ${targetTag} on channel ${channel}; nothing to do.`);
		reporter.finish('succeeded', 'No-op: already up to date.');
		return;
	}

	if (alreadyAtTarget) {
		reporter.log(`Already at ${targetTag}; refreshing install state and production values.`);
	}

	// In-cluster web updates handle dependencies via dedicated phases; locally, resolve state here so Helm upgrade reuses it.
	let installState: InstallState | undefined;
	if (!opts.inCluster) {
		installState = await resolveInstallStateWithProgress(kc, marker?.installState, opts.registry, reporter);
		await ensureDependencies(kc, installState.dependencies);
	} else {
		reporter.log('Cluster dependency installation is handled by the update Job pipeline.');
	}

	// Self-refresh (skip in-cluster — those run the bundled binary in a Pod).
	if (!opts.skipSelfRefresh && !opts.inCluster) {
		await maybeRefreshCli({ opts, release, targetVersion, targetTag, channel, reporter });
	}

	// Capture image tags for audit/debugging and DB update history
	reporter.start('Capturing image tags...');
	const oldTags = await captureImageTags(kc);
	reporter.succeed(`Image tags captured: ${Object.keys(oldTags).length} workloads`);

	if (opts.runId && dbOps) {
		await dbOps.setRunOldImageTags(opts.runId, oldTags);
	}

	// In-cluster path skips dependencies above; resolve state here. Local path reuses.
	const resolvedState = installState ?? (await resolveInstallStateWithProgress(kc, marker?.installState, opts.registry, reporter));
	await ensurePlatformRegistrySecrets(kc, resolvedState, reporter);

	await runHelmUpgrade(resolvedState, targetVersion, reporter);

	reporter.start('Updating version marker...');
	await writeVersionMarker(kc, targetTag, opts.inCluster ? 'job' : 'cli', channel, resolvedState);
	reporter.succeed(`Version marker set to ${targetTag} (channel: ${channel})`);

	reporter.finish('succeeded', `Update to ${targetTag} on channel '${channel}' completed.`);
}

// In-cluster prepare: snapshot image tags + stage the chart. Must not spawn helm or call reporter.finish — the run stays 'running' until finalize.
export async function runPrepare(
	opts: UpdateOpts,
	reporter: ProgressReporter,
	dbOps: { setRunOldImageTags: (runId: string, tags: Record<string, string>) => Promise<void> }
): Promise<void> {
	const target = opts.target;
	if (!target) {
		throw new FatalCliError('--target is required in --in-cluster mode');
	}

	reporter.start('Loading kubeconfig...');
	const kc = loadKubeConfig(true);
	reporter.succeed('Kubeconfig loaded');

	reporter.start('Reading current installation marker...');
	const marker = await readVersionMarker(kc);

	if (marker) {
		reporter.succeed(`Current: ${marker.currentVersion} (channel: ${marker.channel})`);
	} else {
		reporter.succeed('No previous installation marker found');
	}

	// No network: the API resolved --target; the channel comes from the override or marker.
	const channel = resolveChannel({ override: opts.channel, markerChannel: marker?.channel });
	validateTargetForChannel(target, channel);
	reporter.succeed(`Target: ${target} (channel: ${channel})`);

	reporter.start('Capturing image tags...');
	const oldTags = await captureImageTags(kc);
	reporter.succeed(`Image tags captured: ${Object.keys(oldTags).length} workloads`);

	if (opts.runId) {
		await dbOps.setRunOldImageTags(opts.runId, oldTags);
	}

	// Stage the chart where the helm-upgrade phase expects it (shared work volume).
	reporter.start('Staging Helm chart...');
	const chartDest = stagedChartPath();
	copyFileSync(getChartPath(), chartDest);
	reporter.succeed(`Chart staged at ${chartDest}`);
}

// In-cluster dependency repair: helm install/upgrade only the missing deps, keeping healthy updates fast.
export async function runRepairDependencies(reporter: ProgressReporter): Promise<void> {
	reporter.start('Loading kubeconfig...');
	const kc = loadKubeConfig(true);
	reporter.succeed('Kubeconfig loaded');

	const marker = await readVersionMarker(kc);
	const dependencyState = await resolveInstalledDependencyState(kc, marker?.installState);

	await ensureDependenciesSilent(kc, reporter, dependencyState);
}

// In-cluster dependency wait: verifies readiness through Kubernetes APIs only.
export async function runWaitDependencies(reporter: ProgressReporter): Promise<void> {
	reporter.start('Loading kubeconfig...');
	const kc = loadKubeConfig(true);
	reporter.succeed('Kubeconfig loaded');

	const marker = await readVersionMarker(kc);
	const dependencyState = await resolveInstalledDependencyState(kc, marker?.installState);

	await waitDependencies(kc, dependencyState, reporter);
}

// Writes upgrade values to the work volume; helm runs as PID 1 in the helm-upgrade container. Like prepare, must NOT call reporter.finish.
export async function runHelmPlanPhase(opts: UpdateOpts, reporter: ProgressReporter): Promise<void> {
	const target = opts.target;
	if (!target) {
		throw new FatalCliError('--target is required in --in-cluster mode');
	}

	reporter.start('Loading kubeconfig...');
	const kc = loadKubeConfig(true);
	reporter.succeed('Kubeconfig loaded');

	const marker = await readVersionMarker(kc);
	const channel = resolveChannel({ override: opts.channel, markerChannel: marker?.channel });
	validateTargetForChannel(target, channel);

	const desiredRegistry = await readDesiredBuildRegistrySettings();
	const installState = applyDesiredBuildRegistry(await prepareInstallState(kc, marker?.installState, opts.registry, reporter), desiredRegistry);
	await ensureDesiredBuildRegistrySecrets(kc, desiredRegistry, installState, reporter);

	reporter.start('Writing upgrade plan...');
	const valuesPath = inClusterUpgradeValuesPath();
	writeUpgradeValuesFileTo(installState, target.replace(/^v/, ''), valuesPath);
	reporter.succeed(`Upgrade values written to ${valuesPath}`);
}

// Values file the helm-upgrade container reads (`-f`); same shared work volume as stagedChartPath().
function inClusterUpgradeValuesPath(): string {
	return join(process.env.KUBWAVE_WORK_DIR ?? IN_CLUSTER_WORK_DIR, 'upgrade-values.yaml');
}

// In-cluster finalize: runs only after prepare + helm upgrade succeed. The single place that writes the marker and finishes the run.
export async function runFinalize(opts: UpdateOpts, reporter: ProgressReporter): Promise<void> {
	const target = opts.target;
	if (!target) {
		throw new FatalCliError('--target is required in --in-cluster mode');
	}

	reporter.start('Loading kubeconfig...');
	const kc = loadKubeConfig(true);
	reporter.succeed('Kubeconfig loaded');

	const marker = await readVersionMarker(kc);
	const channel = resolveChannel({ override: opts.channel, markerChannel: marker?.channel });
	const desiredRegistry = await readDesiredBuildRegistrySettings();
	const installState = applyDesiredBuildRegistry(
		await resolveInstallState(kc, { markerState: marker?.installState, registryOverride: opts.registry }),
		desiredRegistry
	);

	reporter.start('Updating version marker...');
	await writeVersionMarker(kc, target, 'job', channel, installState);
	reporter.succeed(`Version marker set to ${target} (channel: ${channel})`);

	await reporter.finish('succeeded', `Update to ${target} on channel '${channel}' completed.`);
}

async function resolveUpdateTarget(target: string | undefined, channel: Channel, reporter: ProgressReporter): Promise<ReleaseInfo> {
	try {
		if (target) {
			validateTargetForChannel(target, channel);
			return await getReleaseByTag(target);
		}

		return await resolveLatestRelease(channel);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		reporter.fail('Target resolution', msg);
		reporter.finish('failed', msg);
		throw new FatalCliError(msg, { cause: err });
	}
}

async function maybeRefreshCli(opts: {
	opts: UpdateOpts;
	release: ReleaseInfo;
	targetVersion: string;
	targetTag: string;
	channel: Channel;
	reporter: ProgressReporter;
}): Promise<void> {
	const { opts: updateOpts, release, targetVersion, targetTag, channel, reporter } = opts;
	const decision = describeRefresh(targetVersion);

	if (!decision.needed) {
		if (decision.reason) reporter.log(`Self-refresh: ${decision.reason}`);
		return;
	}

	const hasAsset = release.assets.some(a => a.name === platformAssetName());

	if (!hasAsset) {
		reporter.log(`Release ${targetTag} has no asset for this platform — skipping self-refresh.`);
		return;
	}

	let confirm = updateOpts.yes;
	if (!confirm) {
		const answer = await p.confirm({
			message: `Refresh CLI binary v${decision.current} -> v${decision.target}?`,
			initialValue: true
		});

		if (p.isCancel(answer)) {
			reporter.finish('failed', 'Cancelled by user.');
			throw new UserCancelledError('Update cancelled.');
		}

		confirm = answer === true;
	}

	if (confirm) {
		const forwardArgs = buildForwardArgs(updateOpts, targetTag, channel);
		await refreshAndReExec({ release, reporter, forwardArgs });
		// refreshAndReExec calls process.exit; unreachable
	} else {
		reporter.log(`Continuing with local binary v${decision.current} (target v${decision.target}).`);
	}
}

async function resolveInstallStateWithProgress(
	kc: ReturnType<typeof loadKubeConfig>,
	markerState: PartialInstallState | undefined,
	registryOverride: string | undefined,
	reporter: ProgressReporter
): Promise<InstallState> {
	reporter.start('Resolving install state...');
	const installState = await resolveInstallState(kc, { markerState, registryOverride });
	reporter.succeed(`Install state resolved: ${installState.domain} (${installState.imageRegistry})`);
	return installState;
}

async function prepareInstallState(
	kc: ReturnType<typeof loadKubeConfig>,
	markerState: PartialInstallState | undefined,
	registryOverride: string | undefined,
	reporter: ProgressReporter
): Promise<InstallState> {
	const installState = await resolveInstallStateWithProgress(kc, markerState, registryOverride, reporter);
	return installState;
}

async function ensurePlatformRegistrySecrets(
	kc: ReturnType<typeof loadKubeConfig>,
	installState: InstallState,
	reporter: ProgressReporter
): Promise<void> {
	if (installState.registryMode !== 'platform' || !installState.registryIngressEnabled) return;

	reporter.start('Ensuring platform registry secrets...');
	await createRegistrySecrets(kc, buildRegistryEndpointHost(installState.registryHost));
	reporter.succeed('Platform registry secrets ready');
}

async function runHelmUpgrade(
	installState: InstallState,
	targetVersion: string,
	reporter: ProgressReporter,
	chartPath: string = getChartPath()
): Promise<void> {
	const valuesFile = generateUpgradeValuesFile(installState, targetVersion);

	reporter.start('Running Helm upgrade...');
	const { exitCode, stderr } = await execHelm(buildHelmUpgradeArgs(chartPath, valuesFile));

	if (exitCode !== 0) {
		reporter.fail('Helm upgrade failed', stderr);
		reporter.finish('failed', `Helm upgrade failed: ${stderr}`);
		throw new FatalCliError(`Helm upgrade failed: ${stderr}`);
	}

	reporter.succeed('Helm upgrade applied');
}

function stagedChartPath(): string {
	return join(process.env.KUBWAVE_WORK_DIR ?? IN_CLUSTER_WORK_DIR, 'chart.tgz');
}

function buildForwardArgs(opts: UpdateOpts, targetTag: string, channel: Channel): string[] {
	const args = ['update', '--target', targetTag, '--channel', channel, '--skip-self-refresh'];

	if (opts.registry) args.push('--registry', opts.registry);
	if (opts.clusterConfirmed) args.push('--cluster-confirmed');
	if (opts.yes) args.push('--yes');
	if (opts.inCluster) args.push('--in-cluster');
	if (opts.runId) args.push('--run-id', opts.runId);

	return args;
}
