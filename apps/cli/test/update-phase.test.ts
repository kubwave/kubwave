import { afterEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ProgressReporter } from '../src/lib/progress.js';
import type { InstallState } from '../src/lib/install-state.js';
import type { VersionMarker } from '../src/lib/version-marker.js';

// Spread the real exports of every stubbed module: bun's mock.module is process-global, so stripping exports would break other test files.
import * as realK8s from '../src/lib/k8s.js';
import * as realMarker from '../src/lib/version-marker.js';
import * as realDeps from '../src/lib/dependencies.js';
import * as realRollback from '../src/lib/rollback.js';
import * as realEmbedded from '../src/lib/embedded.js';
import * as realContextConfirm from '../src/lib/context-confirm.js';
import * as realReleases from '../src/lib/releases.js';
import * as realSelfRefresh from '../src/lib/self-refresh.js';
import * as realHelm from '../src/lib/helm.js';
import * as realSecrets from '../src/lib/secrets.js';
import { FatalCliError } from '../src/lib/errors.js';
import type { ReleaseInfo } from '../src/lib/releases.js';
import type { SelfRefreshDecision } from '../src/lib/self-refresh.js';

const defaultMarker: VersionMarker = { currentVersion: 'v0.1.0', installedAt: 'now', installedBy: 'cli', channel: 'stable' };

let marker: VersionMarker | null = defaultMarker;

const writeMarkerCalls: Array<{ version: string; installedBy: string; channel: string }> = [];
const contextConfirmCalls: Array<{ skipConfirm: boolean }> = [];
const dependencyCalls: string[] = [];
const dependencyStates: unknown[] = [];
const oldTagWrites: Array<{ runId: string; tags: Record<string, string> }> = [];
const execHelmCalls: string[][] = [];
const registrySecretCalls: string[] = [];
const refreshCalls: Array<{ release: ReleaseInfo; forwardArgs: string[] }> = [];
const cancelledPrompt = Symbol('cancelled');
const dbStatusCalls: Array<{ runId: string; status: string; phase: string; error?: string }> = [];
const dbCloseCalls: string[] = [];

let execHelmResult = { stdout: '', stderr: '', exitCode: 0 };
let promptConfirmResult: boolean | symbol = true;

let helmValues: Record<string, unknown> = {
	ingress: { host: 'app.example.com', className: 'traefik' },
	api: { image: { repository: 'ghcr.io/kubwave/backend' }, env: { APP_BASE_URL: 'https://app.example.com' } },
	worker: { image: { repository: 'ghcr.io/kubwave/backend' } },
	workloadIngress: { controllerNamespace: 'traefik', clusterIssuer: 'letsencrypt-prod' },
	registry: { enabled: true, ingress: { enabled: true, host: 'registry.app.example.com', clusterIssuer: 'letsencrypt-prod' } },
	update: { dependencies: { traefik: { values: { ingressClass: { enabled: true, isDefaultClass: true } } } } },
	builds: { registry: { endpoint: 'registry.app.example.com', insecure: false } }
};

let latestRelease: ReleaseInfo = releaseInfo('v0.2.0');
let releaseByTagResult: ReleaseInfo | Error = releaseInfo('v0.2.0');
let describeRefreshResult: SelfRefreshDecision = { current: '0.1.0', target: '0.2.0', needed: false, reason: 'already on target version' };
let platformAsset = 'kubwave-test-platform';
let refreshError: Error | null = null;

// A real source chart so runPrepare exercises the actual copyFileSync.
const srcChart = join(mkdtempSync(join(tmpdir(), 'chart-src-')), 'chart.tgz');
writeFileSync(srcChart, 'PK fake chart bytes');

mock.module('~/lib/k8s.js', () => ({ ...realK8s, loadKubeConfig: () => ({}) }));

mock.module('~/lib/db.js', () => ({
	updateRunStatus: async (runId: string, status: string, phase: string, error?: string) => {
		dbStatusCalls.push({ runId, status, phase, error });
	},
	setRunOldImageTags: async (runId: string, tags: Record<string, string>) => {
		oldTagWrites.push({ runId, tags });
	},
	getJsonSetting: async () => null,
	closeDb: async () => {
		dbCloseCalls.push('close');
	}
}));

mock.module('@clack/prompts', () => ({
	confirm: mock(async () => promptConfirmResult),
	isCancel: (value: unknown) => value === cancelledPrompt,
	intro: () => {},
	outro: () => {},
	log: {
		info: () => {},
		warn: () => {},
		error: () => {},
		success: () => {},
		step: () => {}
	},
	spinner: () => ({ start: () => {}, stop: () => {} })
}));

mock.module('~/lib/version-marker.js', () => ({
	...realMarker,
	readVersionMarker: async () => marker,
	writeVersionMarker: async (_kc: unknown, version: string, installedBy: string, channel: string) => {
		writeMarkerCalls.push({ version, installedBy, channel });
	}
}));

mock.module('~/lib/context-confirm.js', () => ({
	...realContextConfirm,
	confirmClusterContext: async (_kc: unknown, skipConfirm: boolean) => {
		contextConfirmCalls.push({ skipConfirm });
	}
}));

mock.module('~/lib/dependencies.js', () => ({
	...realDeps,
	ensureDependenciesSilent: async (_kc: unknown, _reporter: unknown, state?: unknown) => {
		dependencyCalls.push('silent');
		dependencyStates.push(state);
		return [];
	},
	ensureDependencies: async (_kc: unknown, state?: unknown) => {
		dependencyCalls.push('interactive');
		dependencyStates.push(state);
		return [];
	},
	waitDependencies: async (_kc: unknown, state?: unknown) => {
		dependencyCalls.push('wait');
		dependencyStates.push(state);
	}
}));

mock.module('~/lib/rollback.js', () => ({
	...realRollback,
	captureImageTags: async () => ({ api: 'ghcr.io/x/backend:v0.1.0' })
}));

mock.module('~/lib/embedded.js', () => ({ ...realEmbedded, getChartPath: () => srcChart }));

mock.module('~/lib/releases.js', () => ({
	...realReleases,
	resolveLatestRelease: async () => latestRelease,
	getReleaseByTag: async () => {
		if (releaseByTagResult instanceof Error) throw releaseByTagResult;
		return releaseByTagResult;
	},
	platformAssetName: () => platformAsset
}));

mock.module('~/lib/self-refresh.js', () => ({
	...realSelfRefresh,
	describeRefresh: () => describeRefreshResult,
	refreshAndReExec: async (opts: { release: ReleaseInfo; forwardArgs: string[] }) => {
		refreshCalls.push({ release: opts.release, forwardArgs: opts.forwardArgs });
		throw refreshError ?? new Error('reexec');
	}
}));

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	execHelm: async (args: string[]) => {
		execHelmCalls.push(args);

		if (args[0] === 'get' && args[1] === 'values') {
			return { stdout: JSON.stringify(helmValues), stderr: '', exitCode: 0 };
		}

		return execHelmResult;
	}
}));

mock.module('~/lib/secrets.js', () => ({
	...realSecrets,
	createRegistrySecrets: async (_kc: unknown, registryHost: string) => {
		registrySecretCalls.push(registryHost);
	}
}));

const { registerUpdateCommand, runUpdate, runPrepare, runRepairDependencies, runWaitDependencies, runHelmPlanPhase, runFinalize } =
	await import('../src/commands/update.js');
const { buildHelmUpgradeArgs, buildUpgradeValues } = await import('../src/lib/upgrade-plan.js');

function releaseInfo(
	tag: string,
	assets: ReleaseInfo['assets'] = [
		{
			name: 'kubwave-test-platform',
			size: 12,
			downloadUrl: 'https://api.github.com/repos/kubwave/kubwave/releases/assets/test'
		}
	]
): ReleaseInfo {
	return { tag, version: tag.replace(/^v/, ''), prerelease: tag.includes('-'), assets };
}

function silentReporter(): ProgressReporter & { events: string[] } {
	const events: string[] = [];

	return {
		events,
		start: phase => events.push(`start:${phase}`),
		succeed: phase => events.push(`succeed:${phase}`),
		fail: (phase, error) => events.push(`fail:${phase}:${error}`),
		log: message => events.push(`log:${message}`),
		finish: (status, message) => {
			events.push(`finish:${status}:${message}`);
		}
	};
}

function updateOpts(overrides: Partial<Parameters<typeof runUpdate>[0]> = {}): Parameters<typeof runUpdate>[0] {
	return {
		target: 'v0.2.0',
		inCluster: false,
		clusterConfirmed: true,
		skipSelfRefresh: false,
		yes: true,
		...overrides
	};
}

function captureUpdateAction(): (opts: Parameters<typeof runUpdate>[0]) => Promise<void> {
	let capturedAction: ((opts: Parameters<typeof runUpdate>[0]) => Promise<void>) | undefined;
	const command = {
		description() {
			return this;
		},
		option() {
			return this;
		},
		action(fn: (opts: Parameters<typeof runUpdate>[0]) => Promise<void>) {
			capturedAction = fn;
			return this;
		}
	};
	const parent = {
		command(name: string) {
			expect(name).toBe('update');
			return command;
		}
	};

	registerUpdateCommand(parent as never);
	expect(capturedAction).toBeDefined();
	return capturedAction!;
}

const cleanups: string[] = [];
afterEach(() => {
	marker = defaultMarker;

	writeMarkerCalls.length = 0;
	contextConfirmCalls.length = 0;
	dependencyCalls.length = 0;
	dependencyStates.length = 0;
	oldTagWrites.length = 0;
	execHelmCalls.length = 0;
	registrySecretCalls.length = 0;
	refreshCalls.length = 0;
	dbStatusCalls.length = 0;
	dbCloseCalls.length = 0;
	execHelmResult = { stdout: '', stderr: '', exitCode: 0 };

	helmValues = {
		ingress: { host: 'app.example.com', className: 'traefik' },
		api: { image: { repository: 'ghcr.io/kubwave/backend' }, env: { APP_BASE_URL: 'https://app.example.com' } },
		worker: { image: { repository: 'ghcr.io/kubwave/backend' } },
		workloadIngress: { controllerNamespace: 'traefik', clusterIssuer: 'letsencrypt-prod' },
		registry: { enabled: true, ingress: { enabled: true, host: 'registry.app.example.com', clusterIssuer: 'letsencrypt-prod' } },
		update: { dependencies: { traefik: { values: { ingressClass: { enabled: true, isDefaultClass: true } } } } },
		builds: { registry: { endpoint: 'registry.app.example.com', insecure: false } }
	};

	latestRelease = releaseInfo('v0.2.0');
	releaseByTagResult = releaseInfo('v0.2.0');
	describeRefreshResult = { current: '0.1.0', target: '0.2.0', needed: false, reason: 'already on target version' };
	platformAsset = 'kubwave-test-platform';
	refreshError = null;
	promptConfirmResult = true;

	for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('in-cluster update phases', () => {
	test('registers the update command and runs the local action path', async () => {
		const action = captureUpdateAction();

		await action(updateOpts());

		expect(writeMarkerCalls).toEqual([{ version: 'v0.2.0', installedBy: 'cli', channel: 'stable' }]);
		expect(execHelmCalls.some(call => call.includes('upgrade'))).toBe(true);
	});

	test('registered update command dispatches every in-cluster phase and closes the DB', async () => {
		const action = captureUpdateAction();
		const workDir = mkdtempSync(join(tmpdir(), 'work-'));
		cleanups.push(workDir);
		process.env.KUBWAVE_WORK_DIR = workDir;

		try {
			for (const phase of ['prepare', 'repair-dependencies', 'wait-dependencies', 'helm-plan', 'finalize'] as const) {
				await action({
					target: 'v0.2.0',
					registry: 'ghcr.io/kubwave',
					inCluster: true,
					runId: `run-${phase}`,
					phase,
					clusterConfirmed: false,
					skipSelfRefresh: true,
					yes: true
				});
			}
		} finally {
			delete process.env.KUBWAVE_WORK_DIR;
		}

		expect(dbCloseCalls).toEqual(['close', 'close', 'close', 'close', 'close']);
		expect(oldTagWrites).toContainEqual({ runId: 'run-prepare', tags: { api: 'ghcr.io/x/backend:v0.1.0' } });
		expect(writeMarkerCalls).toContainEqual({ version: 'v0.2.0', installedBy: 'job', channel: 'stable' });
		expect(dependencyCalls).toEqual(['silent', 'wait']);
	});

	test('runs a local update through dependencies, shared helm plan, and marker persistence', async () => {
		const out = silentReporter();

		await runUpdate(updateOpts(), out);

		expect(contextConfirmCalls).toEqual([{ skipConfirm: true }]);
		expect(dependencyCalls).toEqual(['interactive']);
		// One `get values` resolves install state for both the dependency check and the upgrade, then `upgrade`.
		expect(execHelmCalls).toHaveLength(2);
		expect(execHelmCalls[0]).toContain('values');
		expect(execHelmCalls[1]).toContain('--atomic');
		expect(upgradeValuesFromCall(execHelmCalls[1]!).console.image.tag).toBe('0.2.0');
		// Platform mode needs the registry htpasswd + dockerconfigjson secrets before Helm applies the chart.
		expect(registrySecretCalls).toEqual(['registry.app.example.com']);
		expect(writeMarkerCalls).toEqual([{ version: 'v0.2.0', installedBy: 'cli', channel: 'stable' }]);
		expect(out.events).toContain("finish:succeeded:Update to v0.2.0 on channel 'stable' completed.");
	});

	test('returns early when the marker already matches the target and channel', async () => {
		marker = { ...defaultMarker, currentVersion: 'v0.2.0', installState: baseInstallState() };
		const out = silentReporter();

		await runUpdate(updateOpts(), out);

		expect(dependencyCalls).toEqual([]);
		expect(execHelmCalls).toEqual([]);
		expect(writeMarkerCalls).toEqual([]);
		expect(out.events).toContain('finish:succeeded:No-op: already up to date.');
	});

	test('resolves latest target and continues when no marker exists', async () => {
		marker = null;
		latestRelease = releaseInfo('v0.3.0');
		const out = silentReporter();

		await runUpdate(updateOpts({ target: undefined, skipSelfRefresh: true }), out);

		expect(out.events).toContain('succeed:No previous installation marker found');
		expect(out.events).toContain('succeed:Target: v0.3.0 (channel: stable)');
		expect(writeMarkerCalls).toEqual([{ version: 'v0.3.0', installedBy: 'cli', channel: 'stable' }]);
	});

	test('cancels when an interactive channel switch is declined', async () => {
		promptConfirmResult = false;
		const out = silentReporter();

		await expect(runUpdate(updateOpts({ channel: 'preview', yes: false }), out)).rejects.toThrow('Channel switch cancelled.');

		expect(out.events).toContain('fail:Channel switch:cancelled by user');
		expect(out.events).toContain('finish:failed:Channel switch cancelled.');
		expect(execHelmCalls).toEqual([]);
	});

	test('cancels when an interactive channel switch prompt is cancelled', async () => {
		promptConfirmResult = cancelledPrompt;
		const out = silentReporter();

		await expect(runUpdate(updateOpts({ channel: 'preview', yes: false }), out)).rejects.toThrow('Channel switch cancelled.');

		expect(out.events).toContain('fail:Channel switch:cancelled by user');
		expect(out.events).toContain('finish:failed:Channel switch cancelled.');
		expect(execHelmCalls).toEqual([]);
	});

	test('refreshes install state when a legacy marker already matches the target', async () => {
		marker = { ...defaultMarker, currentVersion: 'v0.2.0' };
		const out = silentReporter();

		await runUpdate(updateOpts(), out);

		expect(out.events).toContain('log:Already at v0.2.0; refreshing install state and production values.');
		expect(execHelmCalls).toHaveLength(2);
		expect(upgradeValuesFromCall(execHelmCalls[1]!).builds.registry.endpoint).toBe('registry.app.example.com');
		expect(writeMarkerCalls).toEqual([{ version: 'v0.2.0', installedBy: 'cli', channel: 'stable' }]);
	});

	test('skips dependency helm work and stores old image tags for in-cluster runs', async () => {
		const out = silentReporter();

		await runUpdate(updateOpts({ inCluster: true, runId: 'run-42', channel: 'preview' }), out, {
			updateRunStatus: async () => {},
			setRunOldImageTags: async (runId, tags) => {
				oldTagWrites.push({ runId, tags });
			}
		});

		expect(contextConfirmCalls).toEqual([]);
		expect(dependencyCalls).toEqual([]);
		expect(oldTagWrites).toEqual([{ runId: 'run-42', tags: { api: 'ghcr.io/x/backend:v0.1.0' } }]);
		expect(writeMarkerCalls).toEqual([{ version: 'v0.2.0', installedBy: 'job', channel: 'preview' }]);
	});

	test('wraps target resolution failures as fatal CLI errors', async () => {
		releaseByTagResult = new Error('release missing');
		const out = silentReporter();

		await expect(runUpdate(updateOpts(), out)).rejects.toThrow(FatalCliError);
		expect(out.events).toContain('fail:Target resolution:release missing');
		expect(out.events).toContain('finish:failed:release missing');
	});

	test('fails when helm upgrade exits non-zero', async () => {
		execHelmResult = { stdout: '', stderr: 'helm exploded', exitCode: 1 };
		const out = silentReporter();

		await expect(runUpdate(updateOpts(), out)).rejects.toThrow('Helm upgrade failed: helm exploded');

		expect(out.events).toContain('fail:Helm upgrade failed:helm exploded');
		expect(out.events).toContain('finish:failed:Helm upgrade failed: helm exploded');
		expect(writeMarkerCalls).toEqual([]);
	});

	test('skips self-refresh when the release has no platform asset', async () => {
		describeRefreshResult = { current: '0.1.0', target: '0.2.0', needed: true };
		releaseByTagResult = releaseInfo('v0.2.0', []);
		const out = silentReporter();

		await runUpdate(updateOpts(), out);

		expect(refreshCalls).toEqual([]);
		expect(out.events).toContain('log:Release v0.2.0 has no asset for this platform — skipping self-refresh.');
	});

	test('cancels when interactive self-refresh is cancelled', async () => {
		describeRefreshResult = { current: '0.1.0', target: '0.2.0', needed: true };
		promptConfirmResult = cancelledPrompt;
		const out = silentReporter();

		await expect(runUpdate(updateOpts({ yes: false }), out)).rejects.toThrow('Update cancelled.');

		expect(out.events).toContain('finish:failed:Cancelled by user.');
		expect(refreshCalls).toEqual([]);
	});

	test('continues with the local binary when interactive self-refresh is declined', async () => {
		describeRefreshResult = { current: '0.1.0', target: '0.2.0', needed: true };
		promptConfirmResult = false;
		const out = silentReporter();

		await runUpdate(updateOpts({ yes: false }), out);

		expect(out.events).toContain('log:Continuing with local binary v0.1.0 (target v0.2.0).');
		expect(refreshCalls).toEqual([]);
	});

	test('refreshes the CLI and forwards update args when accepted non-interactively', async () => {
		describeRefreshResult = { current: '0.1.0', target: '0.2.0', needed: true };
		const out = silentReporter();

		await expect(runUpdate(updateOpts({ channel: 'preview', registry: 'ghcr.io/kubwave' }), out)).rejects.toThrow('reexec');

		expect(refreshCalls).toHaveLength(1);
		expect(refreshCalls[0]!.forwardArgs).toEqual([
			'update',
			'--target',
			'v0.2.0',
			'--channel',
			'preview',
			'--skip-self-refresh',
			'--registry',
			'ghcr.io/kubwave',
			'--cluster-confirmed',
			'--yes'
		]);
	});

	test('helm upgrade args merge new chart defaults and set the production profile', () => {
		const values = buildUpgradeValues(baseInstallState({ imageRegistry: 'ghcr.io/acme' }), '0.2.0');
		const args = buildHelmUpgradeArgs('/chart.tgz', '/values.yaml');

		expect(args).toContain('--reset-then-reuse-values');
		expect(args).not.toContain('--reuse-values');
		expect(args).toContain('--atomic');
		expect(args).toContain('--wait');
		expect(args).toContain('--timeout');
		expect(args).toContain('10m');
		expect(values.console).toMatchObject({
			image: { repository: 'ghcr.io/acme/console', tag: '0.2.0' },
			resources: {
				requests: { cpu: '100m', memory: '256Mi' },
				limits: { cpu: '1000m', memory: '1Gi' }
			}
		});
		expect(values.update).toMatchObject({ image: { repository: 'ghcr.io/acme/cli', tag: '0.2.0' } });
		expect(values.builds).toMatchObject({
			engine: 'buildkit',
			builderImage: 'moby/buildkit:v0.31.0-rootless',
			buildToolsImage: 'ghcr.io/acme/build-tools:0.2.0'
		});
		expect(values.mailcrab).toEqual({ enabled: false });
		expect(values.adminer).toEqual({ enabled: false });
		expect(values.api).toMatchObject({ secret: { create: false, existingSecret: 'console-creds' } });
		expect(values.postgres).toMatchObject({ secret: { create: false, existingSecret: 'postgres-creds' } });
		expect(values.workloadIngress).toMatchObject({ controllerNamespace: 'traefik' });
	});

	test('helm upgrade pins pullPolicy on every workload so a stale release cannot inherit the dev Never default', () => {
		const values = buildUpgradeValues(baseInstallState({ imageRegistry: 'ghcr.io/acme' }), '0.2.0') as {
			api: { image: { pullPolicy: string } };
			console: { image: { pullPolicy: string } };
			worker: { image: { pullPolicy: string } };
		};

		expect(values.api.image.pullPolicy).toBe('IfNotPresent');
		expect(values.console.image.pullPolicy).toBe('IfNotPresent');
		expect(values.worker.image.pullPolicy).toBe('IfNotPresent');
	});

	test('helm upgrade does not force Cloudfleet node selectors on generic clusters', () => {
		const values = buildUpgradeValues(baseInstallState({ nodeSelector: undefined }), '0.2.0') as Record<string, Record<string, unknown>>;

		expect(values.api).not.toHaveProperty('nodeSelector');
		expect(values.console).not.toHaveProperty('nodeSelector');
		expect(values.worker).not.toHaveProperty('nodeSelector');
		expect(values.postgres).not.toHaveProperty('nodeSelector');
		expect(values.update).not.toHaveProperty('nodeSelector');
	});

	test('helm upgrade preserves the tenant runtime class chosen at install', () => {
		const values = buildUpgradeValues(baseInstallState({ tenantRuntimeClass: 'gvisor' }), '0.2.0') as {
			tenants: { runtimeClass: { default: string; gvisor: { install: boolean } } };
		};

		expect(values.tenants.runtimeClass.default).toBe('gvisor');
		expect(values.tenants.runtimeClass.gvisor.install).toBe(true);
	});

	test('enables the platform registry with TLS ingress and auth secrets', () => {
		const values = buildUpgradeValues(baseInstallState({ domain: 'app.example.com', registryHost: 'registry.app.example.com' }), '0.2.0') as {
			registry: { enabled: boolean; ingress: { enabled: boolean; host: string }; auth: { htpasswdSecretName: string } };
			builds: {
				registry: { endpoint: string; insecure: boolean; pushSecretName: string; pullSecretName: string };
				networkPolicy: {
					ingressController?: {
						enabled?: boolean;
						namespace?: string;
						podLabels?: Record<string, string>;
						ports?: number[];
					};
				};
			};
		};

		expect(values.registry.enabled).toBe(true);
		expect(values.registry.ingress).toMatchObject({ enabled: true, host: 'registry.app.example.com' });
		expect(values.registry.auth.htpasswdSecretName).toBe('registry-htpasswd');
		expect(values.builds.registry.endpoint).toBe('registry.app.example.com');
		expect(values.builds.registry.insecure).toBe(false);
		expect(values.builds.registry.pushSecretName).toBe('registry-creds');
		expect(values.builds.registry.pullSecretName).toBe('kubwave-registry-pull');
		expect(values.builds.networkPolicy.ingressController).toEqual({
			enabled: true,
			namespace: 'traefik',
			podLabels: { 'app.kubernetes.io/name': 'traefik' },
			ports: [80, 443, 8000, 8443]
		});
	});

	test('preserves a legacy internal platform registry without creating public registry auth', async () => {
		marker = {
			...defaultMarker,
			installState: baseInstallState({
				registryHost: 'kubwave-registry.kubwave.svc.cluster.local:5000',
				registryInsecure: true,
				registryIngressEnabled: false,
				registryClusterIssuer: undefined
			})
		};
		const out = silentReporter();

		await runUpdate(updateOpts(), out);

		const values = upgradeValuesFromCall(execHelmCalls[1]!);
		expect(registrySecretCalls).toEqual([]);
		expect(values.registry.ingress).toEqual({ enabled: false });
		expect(values.builds.registry).toEqual({
			endpoint: 'kubwave-registry.kubwave.svc.cluster.local:5000',
			insecure: true,
			pushSecretName: '',
			pullSecretName: ''
		});
	});

	test('in-cluster helm-plan phase resolves state and writes the upgrade values file without running helm upgrade', async () => {
		const out = silentReporter();
		const workDir = mkdtempSync(join(tmpdir(), 'work-'));
		const stagedChart = join(workDir, 'chart.tgz');
		cleanups.push(workDir);
		writeFileSync(stagedChart, 'staged chart bytes');
		process.env.KUBWAVE_WORK_DIR = workDir;

		try {
			await runHelmPlanPhase(
				{
					target: 'v0.2.0',
					registry: 'ghcr.io/kubwave',
					inCluster: true,
					runId: 'run-1',
					phase: 'helm-plan',
					clusterConfirmed: false,
					skipSelfRefresh: true,
					yes: true
				},
				out
			);
		} finally {
			delete process.env.KUBWAVE_WORK_DIR;
		}

		// The plan phase only reads release values; it must NOT run `helm upgrade` (that's the helm-PID-1 container).
		expect(execHelmCalls).toHaveLength(1);
		expect(execHelmCalls[0]).toContain('get');
		expect(execHelmCalls.some(call => call.includes('upgrade'))).toBe(false);

		// It writes the resolved values to the fixed path the helm container reads.
		const valuesPath = join(workDir, 'upgrade-values.yaml');
		const values = parse(readFileSync(valuesPath, 'utf8')) as {
			console: { image: { tag: string } };
			builds: { buildToolsImage: string; registry: { endpoint: string } };
		};
		expect(values.console.image.tag).toBe('0.2.0');
		expect(values.builds.buildToolsImage).toBe('ghcr.io/kubwave/build-tools:0.2.0');
		expect(values.builds.registry.endpoint).toBe('registry.app.example.com');
	});

	test('prepare stages the chart on the work volume without any network call', async () => {
		marker = null;
		const workDir = mkdtempSync(join(tmpdir(), 'work-'));
		cleanups.push(workDir);
		process.env.KUBWAVE_WORK_DIR = workDir;

		const originalFetch = globalThis.fetch;
		let fetchCalled = false;
		globalThis.fetch = (() => {
			fetchCalled = true;
			throw new Error('prepare must not hit the network');
		}) as unknown as typeof fetch;

		const tags: Record<string, string>[] = [];
		try {
			await runPrepare(
				{
					target: 'v0.2.0',
					registry: 'ghcr.io/kubwave',
					inCluster: true,
					runId: 'run-1',
					phase: 'prepare',
					clusterConfirmed: false,
					skipSelfRefresh: true,
					yes: true
				},
				silentReporter(),
				{
					setRunOldImageTags: async (_runId, t) => {
						tags.push(t);
					}
				}
			);
		} finally {
			globalThis.fetch = originalFetch;
			delete process.env.KUBWAVE_WORK_DIR;
		}

		const staged = join(workDir, 'chart.tgz');
		expect(existsSync(staged)).toBe(true);
		expect(readFileSync(staged)).toEqual(readFileSync(srcChart));
		expect(fetchCalled).toBe(false);
		expect(dependencyCalls).toEqual([]);
		expect(execHelmCalls).toEqual([]);
		expect(tags[0]).toEqual({ api: 'ghcr.io/x/backend:v0.1.0' });
	});

	test('requires target for in-cluster phases that persist target state', async () => {
		const opts = {
			inCluster: true,
			runId: 'run-1',
			clusterConfirmed: false,
			skipSelfRefresh: true,
			yes: true
		};

		await expect(runPrepare({ ...opts, phase: 'prepare' }, silentReporter(), { setRunOldImageTags: async () => {} })).rejects.toThrow(
			'--target is required'
		);
		await expect(runHelmPlanPhase({ ...opts, phase: 'helm-plan' }, silentReporter())).rejects.toThrow('--target is required');
		await expect(runFinalize({ ...opts, phase: 'finalize' }, silentReporter())).rejects.toThrow('--target is required');
	});

	test('builds dependency helm args from registry helpers', () => {
		const traefikArgs = realDeps.buildTraefikDependencyHelmArgs();
		expect(traefikArgs).toContain('--repo');
		expect(traefikArgs).toContain('https://traefik.github.io/charts');
		expect(traefikArgs).toContain('--reuse-values');
		expect(traefikArgs).not.toContain('--set');

		const certManagerArgs = realDeps.buildCertManagerDependencyHelmArgs();
		expect(certManagerArgs).toContain('--repo');
		expect(certManagerArgs).toContain('https://charts.jetstack.io');
		expect(certManagerArgs).toContain('--reuse-values');
		expect(certManagerArgs).toContain('crds.enabled=true');
	});

	test('repair-dependencies resolves installed dependency state and delegates conditional repair', async () => {
		helmValues = {
			...helmValues,
			update: {
				dependencies: {
					traefik: {
						values: {
							nodeSelector: { 'cfke.io/provider': 'hetzner' },
							service: { type: 'LoadBalancer' }
						}
					}
				}
			}
		};

		await runRepairDependencies(silentReporter());

		expect(dependencyCalls).toEqual(['silent']);
		expect(execHelmCalls).toEqual([['get', 'values', 'kubwave', '-n', 'kubwave', '-o', 'json', '--all']]);
		expect(dependencyStates[0]).toMatchObject({
			traefik: {
				namespace: 'traefik',
				ingressClassName: 'traefik',
				helmValues: {
					nodeSelector: { 'cfke.io/provider': 'hetzner' },
					service: { type: 'LoadBalancer' }
				}
			}
		});
	});

	test('wait-dependencies delegates readiness to the dependency registry', async () => {
		await runWaitDependencies(silentReporter());

		expect(dependencyCalls).toEqual(['wait']);
		expect(execHelmCalls).toEqual([['get', 'values', 'kubwave', '-n', 'kubwave', '-o', 'json', '--all']]);
		expect(dependencyStates[0]).toMatchObject({
			traefik: {
				namespace: 'traefik',
				ingressClassName: 'traefik'
			},
			certManager: {}
		});
	});

	test('finalize does not resolve until the terminal status write completes', async () => {
		const order: string[] = [];
		let resolveWrite!: () => void;
		const reporter: ProgressReporter = {
			start: () => {},
			succeed: () => {},
			fail: () => {},
			log: () => {},
			finish: () =>
				new Promise<void>(resolve => {
					resolveWrite = () => {
						order.push('status-write');
						resolve();
					};
				})
		};

		let returned = false;
		const finalize = runFinalize(
			{
				target: 'v0.2.0',
				registry: 'ghcr.io/kubwave',
				inCluster: true,
				runId: 'run-1',
				phase: 'finalize',
				clusterConfirmed: false,
				skipSelfRefresh: true,
				yes: true
			},
			reporter
		).then(() => {
			order.push('finalize-returned');
			returned = true;
		});

		await Bun.sleep(0);
		expect(returned).toBe(false); // finalize must await the terminal write before returning

		resolveWrite();
		await finalize;
		expect(order).toEqual(['status-write', 'finalize-returned']);
	});

	test('finalize writes the version marker as installed-by job', async () => {
		await runFinalize(
			{
				target: 'v0.2.0',
				registry: 'ghcr.io/kubwave',
				inCluster: true,
				runId: 'run-1',
				phase: 'finalize',
				clusterConfirmed: false,
				skipSelfRefresh: true,
				yes: true
			},
			silentReporter()
		);

		expect(writeMarkerCalls).toHaveLength(1);
		expect(writeMarkerCalls[0]).toEqual({ version: 'v0.2.0', installedBy: 'job', channel: 'stable' });
	});
});

function baseInstallState(overrides: Partial<InstallState> = {}): InstallState {
	return {
		domain: 'app.example.com',
		imageRegistry: 'ghcr.io/kubwave',
		registryHost: 'registry.app.example.com',
		registryMode: 'platform',
		registryInsecure: false,
		registryIngressEnabled: true,
		registryClusterIssuer: 'letsencrypt-prod',
		clusterIssuerName: 'letsencrypt-prod',
		platformId: 'cloudfleet-hetzner',
		ingressClassName: 'traefik',
		ingressControllerNamespace: 'traefik',
		ha: false,
		traefikValues: { ingressClass: { enabled: true, isDefaultClass: true } },
		dependencies: {
			traefik: {
				kind: 'traefik',
				namespace: 'traefik',
				releaseName: 'traefik',
				ingressClassName: 'traefik',
				helmValues: { ingressClass: { enabled: true, isDefaultClass: true } }
			},
			certManager: {},
			cnpg: {}
		},
		...overrides
	};
}

function upgradeValuesFromCall(call: string[]) {
	const valuesFlag = call.indexOf('-f');

	expect(valuesFlag).toBeGreaterThanOrEqual(0);

	const valuesPath = call[valuesFlag + 1];

	expect(valuesPath).toBeDefined();

	return parse(readFileSync(valuesPath!, 'utf8')) as {
		console: { image: { tag: string } };
		registry: { ingress: { enabled: boolean }; auth?: { htpasswdSecretName: string } };
		builds: { registry: { endpoint: string; insecure: boolean; pushSecretName: string; pullSecretName: string } };
	};
}
