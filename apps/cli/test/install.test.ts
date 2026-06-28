import { describe, expect, test } from 'bun:test';
import { mock } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import * as realK8s from '../src/lib/k8s.js';
import * as realHelm from '../src/lib/helm.js';
import * as realSecrets from '../src/lib/secrets.js';
import * as realCliVersion from '../src/lib/cli-version.js';
import * as realErrors from '../src/lib/errors.js';
import { APP_NAMESPACE } from '../src/lib/constants.js';
import type { InstallConfig } from '../src/lib/helm.js';
import { clackStub } from './support/clack-stub.js';

const { FatalCliError } = realErrors;

// runInstall is private, so we drive it via the captured action handler; collaborators are mocked, but channel/releases/install-state/prompts stay REAL.

type InstallOpts = {
	domain?: string;
	email?: string;
	channel: string;
	registry: string;
	clusterConfirmed: boolean;
	inCluster: boolean;
	platform?: string;
	hetznerLbLocation?: string;
	storage: string;
	storageClass?: string;
	tenantPodSecurity: string;
	tenantRuntimeClass: string;
	ha: boolean;
};

interface Captures {
	valuesConfig?: InstallConfig;
	helmConfig?: InstallConfig;
	helmValuesFile?: string;
	marker?: { version: string; by: string; channel: string; state: unknown };
	storageOpts?: { storageMode: string; storageClass?: string };
	clusterIssuerInput?: unknown;
	registrySecrets?: { host: string };
}

const events: string[] = [];
const apiCalls: string[] = [];
const logs: string[] = [];
const printAndExitCalls: unknown[] = [];
let cap: Captures = {};

let namespaceExists = true;
let readyNodeCount = 3;
let preflightPasses = true;
let cliVersionValue = '1.2.3';

const api = {
	readNamespace: async ({ name }: { name: string }) => {
		apiCalls.push(`read-namespace:${name}`);
		if (!namespaceExists) throw { code: 404 };
		events.push('namespace');
		return { metadata: { name } };
	},
	createNamespace: async ({ body }: { body: { metadata: { name: string } } }) => {
		apiCalls.push(`create-namespace:${body.metadata.name}`);
		events.push('namespace');
	},
	listNode: async () => {
		apiCalls.push('list-node');
		return {
			items: Array.from({ length: readyNodeCount }, () => ({
				status: { conditions: [{ type: 'Ready', status: 'True' }] }
			}))
		};
	}
};

const fakePlatform = {
	id: 'test-platform',
	label: 'Test Platform',
	description: 'test platform',
	provider: 'hetzner',
	nodeSelector: { 'kubwave.io/role': 'system' },
	dependencies: {},
	ensureStorage: async (_kc: unknown, opts: { storageMode: string; storageClass?: string }) => {
		events.push('ensure-storage');
		cap.storageOpts = opts;
		// No nodeSelector → install must fall back to platform.nodeSelector (config-propagation test).
		return { storageClass: 'fast-ssd' };
	}
};

// passwordValue controls what p.password returns for prompts that are still covered by shared prompt tests.
let passwordValue = 's3cret';
// textValues is a queue of values returned by p.text in order. Reset in resetFixtures.
const textValues: string[] = [];

mock.module('@clack/prompts', () => ({
	...clackStub(),
	intro: (m: string) => logs.push(`intro:${m}`),
	outro: (m: string) => logs.push(`outro:${m}`),
	isCancel: () => false,
	log: {
		...clackStub().log,
		success: (m: string) => logs.push(`success:${m}`),
		info: (m: string) => logs.push(`info:${m}`),
		warn: (m: string) => logs.push(`warn:${m}`),
		error: (m: string) => logs.push(`error:${m}`),
		step: (m: string) => logs.push(`step:${m}`)
	},
	spinner: () => ({ start: () => {}, stop: () => {} }),
	select: async () => 'platform',
	// p.text is used by promptInstallInputs when domain/email are omitted.
	text: async () => textValues.shift() ?? '',
	password: async () => passwordValue
}));

mock.module('~/lib/k8s.js', () => ({
	...realK8s,
	loadKubeConfig: () => ({ makeApiClient: () => api }) as unknown as KubeConfig
}));

mock.module('~/lib/preflight.js', () => ({
	runPreflightChecks: async () => {
		events.push('preflight');
		return {
			allPassed: preflightPasses,
			results: preflightPasses ? [{ ok: true, label: 'Cluster', message: 'reachable' }] : [{ ok: false, label: 'Cluster', message: 'unreachable' }]
		};
	}
}));

mock.module('~/lib/context-confirm.js', () => ({
	confirmClusterContext: async () => {
		events.push('confirm-context');
	}
}));

mock.module('~/lib/platforms.js', () => ({
	selectPlatform: async () => {
		events.push('select-platform');
		return fakePlatform;
	}
}));

mock.module('~/lib/dependencies.js', () => ({
	ensureDependencies: async () => {
		events.push('ensure-deps');
	}
}));

mock.module('~/lib/adoption.js', () => ({
	checkAdoption: async () => {
		events.push('check-adoption');
		return { hasOrphans: false, reuseData: false };
	}
}));

mock.module('~/lib/cert-manager.js', () => ({
	resolveCertManagerClusterIssuer: async (_kc: unknown, input: { email: string }) => {
		events.push('resolve-cluster-issuer');
		cap.clusterIssuerInput = input;
		return {
			action: 'create',
			clusterIssuer: { name: 'letsencrypt-prod', create: true, email: input.email },
			emailMismatch: false
		};
	}
}));

mock.module('~/lib/secrets.js', () => ({
	...realSecrets,
	createSecrets: async () => {
		events.push('create-secrets');
	},
	createRegistrySecrets: async (_kc: unknown, host: string) => {
		events.push('create-registry-secrets');
		cap.registrySecrets = { host };
	}
}));

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	generateValuesFile: (config: InstallConfig) => {
		events.push('gen-values');
		cap.valuesConfig = config;
		return '/tmp/test-values.yaml';
	},
	helmUpgradeInstall: async (config: InstallConfig, valuesFile: string) => {
		events.push('helm-install');
		cap.helmConfig = config;
		cap.helmValuesFile = valuesFile;
	}
}));

mock.module('~/lib/version-marker.js', () => ({
	writeVersionMarker: async (_kc: unknown, version: string, by: string, channel: string, state: unknown) => {
		events.push('write-marker');
		cap.marker = { version, by, channel, state };
	}
}));

mock.module('~/lib/cli-version.js', () => ({
	...realCliVersion,
	getCliVersion: () => cliVersionValue
}));

mock.module('~/lib/errors.js', () => ({
	...realErrors,
	printAndExit: (err: unknown) => {
		events.push('print-and-exit');
		printAndExitCalls.push(err);
		throw err;
	}
}));

const { registerInstallCommand, parseTenantRuntimeClass } = await import('../src/commands/install.js');

const HAPPY_ORDER = [
	'preflight',
	'confirm-context',
	'select-platform',
	'ensure-deps',
	'ensure-storage',
	'check-adoption',
	'resolve-cluster-issuer',
	'namespace',
	'create-secrets',
	'gen-values',
	'helm-install',
	'write-marker'
];

function resetFixtures(): void {
	events.length = 0;
	apiCalls.length = 0;
	logs.length = 0;
	printAndExitCalls.length = 0;
	textValues.length = 0;
	cap = {};
	namespaceExists = true;
	readyNodeCount = 3;
	preflightPasses = true;
	cliVersionValue = '1.2.3';
	passwordValue = 's3cret';
}

// Registers the install command on a minimal fake commander parent and returns the captured action handler.
function registerAndCaptureAction(): (opts: InstallOpts) => Promise<void> {
	let captured: ((opts: InstallOpts) => Promise<void>) | undefined;
	const command = {
		description() {
			return this;
		},
		option() {
			return this;
		},
		action(fn: (opts: InstallOpts) => Promise<void>) {
			captured = fn;
			return this;
		}
	};
	const parent = {
		command(name: string) {
			expect(name).toBe('install');
			return command;
		}
	};

	registerInstallCommand(parent as never);
	if (!captured) throw new Error('install action was not registered');
	return captured;
}

function baseOpts(overrides: Partial<InstallOpts> = {}): InstallOpts {
	return {
		domain: 'console.example.com',
		email: 'admin@example.com',
		channel: 'stable',
		registry: 'ghcr.io/kubwave',
		clusterConfirmed: true,
		inCluster: false,
		platform: 'test-platform',
		storage: 'auto',
		tenantPodSecurity: 'baseline',
		tenantRuntimeClass: 'off',
		ha: false,
		...overrides
	};
}

describe('install command', () => {
	test('registers the install command and runs to completion', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts());

		expect(logs).toContain('success:kubwave v1.2.3 (stable channel) installed successfully on Test Platform!');
		expect(logs).toContain('info:Open https://console.example.com to create the first admin account.');
	});

	test('runs the install steps in the correct order', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts());

		expect(events).toEqual(HAPPY_ORDER);
	});

	test('passes a fully resolved config to the chart and the version marker', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts());

		// generateValuesFile and helmUpgradeInstall receive the same config object.
		expect(cap.valuesConfig).toBe(cap.helmConfig);
		expect(cap.helmConfig).toMatchObject({
			domain: 'console.example.com',
			email: 'admin@example.com',
			version: '1.2.3',
			imageRegistry: 'ghcr.io/kubwave',
			namespace: APP_NAMESPACE,
			storageClass: 'fast-ssd',
			// storage returned no nodeSelector → falls back to platform.nodeSelector
			nodeSelector: { 'kubwave.io/role': 'system' },
			certManagerClusterIssuer: { name: 'letsencrypt-prod', create: true, email: 'admin@example.com' },
			ha: false
		});
		expect(cap.helmValuesFile).toBe('/tmp/test-values.yaml');
		expect(cap.clusterIssuerInput).toEqual({ email: 'admin@example.com', dependencies: {} });

		expect(cap.marker?.version).toBe('v1.2.3');
		expect(cap.marker?.by).toBe('cli');
		expect(cap.marker?.channel).toBe('stable');
		// state is built by the REAL buildInstallState from the resolved config + platform id.
		expect(cap.marker?.state).toMatchObject({ platformId: 'test-platform', domain: 'console.example.com', ha: false });

		expect(cap.storageOpts?.storageMode).toBe('auto');
	});

	test('threads --tenant-pod-security through the resolved config and the persisted marker', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts({ tenantPodSecurity: 'restricted' }));

		expect(cap.helmConfig?.tenantPodSecurity).toBe('restricted');
		expect(cap.marker?.state).toMatchObject({ tenantPodSecurity: 'restricted' });
	});

	test("maps --tenant-pod-security off to the empty 'disable PSS labels' value", async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts({ tenantPodSecurity: 'off' }));

		expect(cap.helmConfig?.tenantPodSecurity).toBe('');
	});

	test('rejects an invalid --tenant-pod-security value before touching the cluster', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await expect(action(baseOpts({ tenantPodSecurity: 'nope' }))).rejects.toThrow(
			"--tenant-pod-security must be 'baseline', 'restricted', or 'off', got 'nope'"
		);
	});

	test('threads --tenant-runtime-class through the resolved config and the persisted marker', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts({ tenantRuntimeClass: 'gvisor' }));

		expect(cap.helmConfig?.tenantRuntimeClass).toBe('gvisor');
		expect(cap.marker?.state).toMatchObject({ tenantRuntimeClass: 'gvisor' });
	});

	test("maps --tenant-runtime-class off to '' and persists it in the marker (so off survives upgrades)", async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts({ tenantRuntimeClass: 'off' }));

		// The helm config must carry the empty string so the runtimeClass block is omitted from values.
		expect(cap.helmConfig?.tenantRuntimeClass).toBe('');
		// The marker state must also record '' (not omit the key), so a later upgrade sees off instead of the stale live Helm value.
		expect(cap.marker?.state).toMatchObject({ tenantRuntimeClass: '' });
	});

	test('--tenant-runtime-class rejects a runtime the CLI cannot install (e.g. kata)', () => {
		expect(() => parseTenantRuntimeClass('kata')).toThrow("--tenant-runtime-class must be 'gvisor' or 'off', got 'kata'");
	});

	test('creates the namespace when it is absent', async () => {
		resetFixtures();
		namespaceExists = false;
		const action = registerAndCaptureAction();

		await action(baseOpts());

		expect(apiCalls).toContain(`create-namespace:${APP_NAMESPACE}`);
	});

	test('skips namespace creation when it already exists', async () => {
		resetFixtures();
		namespaceExists = true;
		const action = registerAndCaptureAction();

		await action(baseOpts());

		expect(apiCalls).toContain(`read-namespace:${APP_NAMESPACE}`);
		expect(apiCalls.some(call => call.startsWith('create-namespace'))).toBe(false);
	});

	test('warns when --ha is set but fewer than 3 nodes are Ready', async () => {
		resetFixtures();
		readyNodeCount = 1;
		const action = registerAndCaptureAction();

		await action(baseOpts({ ha: true }));

		expect(apiCalls).toContain('list-node');
		expect(logs.some(log => log.startsWith('warn:') && log.includes('only 1 Ready node'))).toBe(true);
	});

	test('does not warn when --ha is set and 3+ nodes are Ready', async () => {
		resetFixtures();
		readyNodeCount = 3;
		const action = registerAndCaptureAction();

		await action(baseOpts({ ha: true }));

		expect(apiCalls).toContain('list-node');
		expect(logs.some(log => log.startsWith('warn:') && log.includes('Ready node'))).toBe(false);
	});

	test('skips the node check entirely without --ha', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts({ ha: false }));

		expect(apiCalls).not.toContain('list-node');
	});

	test('aborts before provisioning when preflight checks fail', async () => {
		resetFixtures();
		preflightPasses = false;
		const action = registerAndCaptureAction();

		await expect(action(baseOpts())).rejects.toThrow('Preflight checks failed. Fix the issues above and try again.');
		expect(printAndExitCalls).toHaveLength(1);
		expect(printAndExitCalls[0]).toBeInstanceOf(FatalCliError);
		// Nothing past the preflight gate ran.
		expect(events).toEqual(['preflight', 'print-and-exit']);
	});

	test('rejects an invalid --storage mode before touching the cluster', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await expect(action(baseOpts({ storage: 'nope' }))).rejects.toThrow("--storage must be 'auto' or 'skip', got 'nope'");
		expect(printAndExitCalls).toHaveLength(1);
		// printAndExit (mocked) records itself; the failure happens before any step runs.
		expect(events).toEqual(['print-and-exit']);
	});

	test('rejects an invalid --channel via the real channel parser', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await expect(action(baseOpts({ channel: 'edge' }))).rejects.toThrow("--channel must be 'stable' or 'preview'");
		// printAndExit (mocked) records itself; the failure happens before any step runs.
		expect(events).toEqual(['print-and-exit']);
	});

	test('rejects a prerelease CLI version on the stable channel (real target validation)', async () => {
		resetFixtures();
		cliVersionValue = 'dev';
		const action = registerAndCaptureAction();

		await expect(action(baseOpts({ channel: 'stable' }))).rejects.toThrow('Stable channel only accepts non-prerelease semver versions');
		// printAndExit (mocked) records itself; the failure happens before any step runs.
		expect(events).toEqual(['print-and-exit']);
	});

	test('does not configure the build registry during install', async () => {
		resetFixtures();
		const action = registerAndCaptureAction();

		await action(baseOpts());

		expect(cap.registrySecrets).toBeUndefined();
		expect(cap.valuesConfig?.buildRegistry).toBeUndefined();
		expect(cap.marker?.state).toMatchObject({ registryMode: 'unconfigured', registryHost: '' });
		expect(logs).toContain('info:Build registry setup will continue in the Console at https://console.example.com.');
	});
});
