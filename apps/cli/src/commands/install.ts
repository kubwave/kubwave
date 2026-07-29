import { InvalidArgumentError, type Command } from 'commander';
import * as p from '@clack/prompts';
import { CoreV1Api, type KubeConfig } from '@kubernetes/client-node';
import { APP_NAMESPACE, DEFAULT_REGISTRY } from '~/lib/constants.js';
import { loadKubeConfig } from '~/lib/k8s.js';
import { runPreflightChecks } from '~/lib/preflight.js';
import { confirmClusterContext } from '~/lib/context-confirm.js';
import { ensureDependencies, waitForCnpgReady } from '~/lib/dependencies.js';
import { assertValidInstallFlags, promptInstallInputs } from '~/lib/prompts.js';
import { checkAdoption } from '~/lib/adoption.js';
import { resolveCertManagerClusterIssuer } from '~/lib/cert-manager.js';
import { createSecrets } from '~/lib/secrets.js';
import { generateValuesFile, helmUpgradeInstall, dnsPolicyForPlatform } from '~/lib/helm.js';
import { selectPlatform } from '~/lib/platforms.js';
import { warmNodes } from '~/lib/node-warmup.js';
import { writeVersionMarker } from '~/lib/version-marker.js';
import { getCliVersion } from '~/lib/cli-version.js';
import { parseChannel, type Channel } from '~/lib/channel.js';
import { validateTargetForChannel } from '~/lib/releases.js';
import { buildInstallState } from '~/lib/install-state.js';
import { FatalCliError, printAndExit } from '~/lib/errors.js';
import type { InstallConfig } from '~/lib/helm.js';
import type { AutoscalingDecision, Platform, UpcloudNodeGroup } from '~/lib/platforms.js';
import { parseUpcloudNodeGroup } from '~/platforms/upcloud/autoscaling.js';

export function registerInstallCommand(parent: Command): void {
	parent
		.command('install')
		.description('Installs kubwave on a Kubernetes cluster')
		.option('--domain <fqdn>', 'Domain for the Console')
		.option('--email <email>', "Email for Let's Encrypt")
		.option('--channel <stable|preview>', 'Release channel for future updates', 'stable')
		.option('--registry <url>', 'Container registry', DEFAULT_REGISTRY)
		.option('--cluster-confirmed', 'Skip cluster confirmation', false)
		.option('--in-cluster', 'Use in-cluster kubeconfig', false)
		.option('--platform <id>', 'Target platform: cloudfleet-hetzner, cloudfleet-gcp, upcloud-uks, or infomaniak-pck (prompted when omitted)')
		.option('--hetzner-lb-location <loc>', 'Hetzner Load Balancer location (fsn1|nbg1|hel1|ash|hil); used by cloudfleet-hetzner')
		.option(
			'--infomaniak-floating-network-id <uuid>',
			'OpenStack external network for the Octavia floating IP; used by infomaniak-pck when the project has no default external network'
		)
		.option('--upcloud-autoscaling', 'Install UpCloud Cluster Autoscaler (required with --yes for upcloud-uks)')
		.option('--no-upcloud-autoscaling', 'Skip UpCloud Cluster Autoscaler')
		.option('--upcloud-cluster-uuid <uuid>', 'UpCloud UKS cluster UUID (for Cluster Autoscaler)')
		.option('--upcloud-token <token>', 'UpCloud API token (or set UPCLOUD_TOKEN); preferred')
		.option('--upcloud-username <user>', 'UpCloud API username (or set UPCLOUD_USERNAME; basic auth, less reliable)')
		.option('--upcloud-password <pass>', 'UpCloud API password (or set UPCLOUD_PASSWORD; basic auth, less reliable)')
		.option(
			'--upcloud-node-group <spec>',
			'Node group to autoscale as <min>:<max>:<name>; repeatable',
			(value, prev: UpcloudNodeGroup[]) => {
				try {
					return [...prev, parseUpcloudNodeGroup(value)];
				} catch (err) {
					throw new InvalidArgumentError(err instanceof Error ? err.message : String(err));
				}
			},
			[] as UpcloudNodeGroup[]
		)
		.option('--upcloud-autoscaler-image-tag <tag>', 'Override the UpCloud autoscaler image tag (or set UPCLOUD_AUTOSCALER_IMAGE_TAG)')
		.option('--storage <mode>', 'Storage handling mode: auto | skip', 'auto')
		.option('--storage-class <name>', 'Use this StorageClass and skip CSI auto-install')
		.option(
			'--tenant-pod-security <level>',
			'Pod Security Standards enforce level for tenant namespaces (baseline|restricted|off). restricted requires every tenant image to run non-root.',
			'baseline'
		)
		.option(
			'--tenant-runtime-class <class>',
			'Sandbox runtime for tenant pods: gvisor | off (default off). gvisor auto-installs on all Linux nodes.',
			'off'
		)
		.option('--ha', 'Enable high availability (3 replicas of api/console/worker + the CNPG database, soft-spread across nodes)', false)
		.option(
			'--no-warm-nodes',
			'Disable pre-provisioning capacity before install. By default, on autoscaling clusters short on capacity, the CLI briefly runs pause pods so the required nodes come up before helm --wait starts.'
		)
		.option('--yes', 'Non-interactive: assume yes for all confirmations (requires --domain, --email, --platform)', false)
		.action(
			async (opts: {
				domain?: string;
				email?: string;
				channel: string;
				registry: string;
				clusterConfirmed: boolean;
				inCluster: boolean;
				platform?: string;
				hetznerLbLocation?: string;
				infomaniakFloatingNetworkId?: string;
				upcloudAutoscaling?: boolean;
				upcloudClusterUuid?: string;
				upcloudToken?: string;
				upcloudUsername?: string;
				upcloudPassword?: string;
				upcloudNodeGroup?: UpcloudNodeGroup[];
				upcloudAutoscalerImageTag?: string;
				storage: string;
				storageClass?: string;
				tenantPodSecurity: string;
				tenantRuntimeClass: string;
				ha: boolean;
				warmNodes: boolean;
				yes: boolean;
			}) => {
				try {
					await runInstall(opts);
				} catch (err) {
					printAndExit(err);
				}
			}
		);
}

async function runInstall(opts: {
	domain?: string;
	email?: string;
	channel: string;
	registry: string;
	clusterConfirmed: boolean;
	inCluster: boolean;
	platform?: string;
	hetznerLbLocation?: string;
	infomaniakFloatingNetworkId?: string;
	upcloudAutoscaling?: boolean;
	upcloudClusterUuid?: string;
	upcloudToken?: string;
	upcloudUsername?: string;
	upcloudPassword?: string;
	upcloudNodeGroup?: UpcloudNodeGroup[];
	upcloudAutoscalerImageTag?: string;
	storage: string;
	storageClass?: string;
	tenantPodSecurity: string;
	tenantRuntimeClass: string;
	ha: boolean;
	warmNodes: boolean;
	yes: boolean;
}): Promise<void> {
	p.intro('kubwave install');

	const assumeYes = opts.yes;
	if (assumeYes && (!opts.domain || !opts.email || !opts.platform)) {
		throw new FatalCliError('--yes is non-interactive and requires --domain, --email, and --platform.');
	}
	assertValidInstallFlags({ domain: opts.domain, email: opts.email });
	const channel = parseChannel(opts.channel, '--channel');
	const storageMode = parseStorageMode(opts.storage);
	const tenantPodSecurity = parseTenantPodSecurity(opts.tenantPodSecurity);
	const tenantRuntimeClass = parseTenantRuntimeClass(opts.tenantRuntimeClass);
	const cliVersion = getCliVersion();
	validateTargetForChannel(cliVersion, channel);
	const kc = await loadAndCheckCluster(opts.inCluster);

	await confirmClusterContext(kc, opts.clusterConfirmed || assumeYes);
	const platform = await selectPlatform({
		platform: opts.platform,
		hetznerLbLocation: opts.hetznerLbLocation,
		infomaniakFloatingNetworkId: opts.infomaniakFloatingNetworkId,
		assumeYes
	});
	const warmup = await warmNodes(kc, platform, { ha: opts.ha, assumeYes, enabled: opts.warmNodes });
	if (warmup.raiseTimeout) raiseInstallTimeoutForColdStart();
	try {
		await ensureDependencies(kc, platform.dependencies, undefined, { assumeYes });
		const storage = await platform.ensureStorage(kc, { storageMode, storageClass: opts.storageClass, assumeYes });
		const autoscaling = await platform.ensureAutoscaling?.(kc, {
			upcloudAutoscaling: opts.upcloudAutoscaling,
			upcloudClusterUuid: opts.upcloudClusterUuid,
			upcloudToken: opts.upcloudToken,
			upcloudUsername: opts.upcloudUsername,
			upcloudPassword: opts.upcloudPassword,
			upcloudNodeGroups: opts.upcloudNodeGroup,
			upcloudAutoscalerImageTag: opts.upcloudAutoscalerImageTag,
			assumeYes
		});
		await checkAdoption(kc, assumeYes);

		const config = await resolveInstallConfig(opts, storage, autoscaling, channel, cliVersion, platform, tenantPodSecurity, tenantRuntimeClass);
		const resolvedConfig = await resolveInstallClusterIssuer(kc, config);
		if (resolvedConfig.ha) await warnIfFewNodesForHa(kc);
		await prepareClusterResources(kc, resolvedConfig);
		await waitForDatabaseOperator(kc);
		await installChart(resolvedConfig);
		await writeInstallMarker(kc, resolvedConfig, cliVersion, channel, platform);

		p.log.success(`kubwave v${cliVersion} (${channel} channel) installed successfully on ${platform.label}!`);
		p.log.info(`Open https://${resolvedConfig.domain} to create the first admin account.`);
		p.outro('Installation complete');
	} finally {
		await warmup.cleanup();
	}
}

async function loadAndCheckCluster(inCluster: boolean): Promise<KubeConfig> {
	const spinner = p.spinner();
	spinner.start('Loading kubeconfig...');
	const kc = loadKubeConfig(inCluster);
	spinner.stop('Kubeconfig loaded');

	spinner.start('Running preflight checks...');
	const { allPassed, results } = await runPreflightChecks(kc);
	spinner.stop('Preflight checks complete');

	for (const r of results) {
		if (r.ok) p.log.success(`${r.label}: ${r.message}`);
		else p.log.error(`${r.label}: ${r.message}`);
	}

	if (!allPassed) {
		throw new FatalCliError('Preflight checks failed. Fix the issues above and try again.');
	}

	return kc;
}

// Best-effort nudge: HA wants ≥3 nodes to spread, but soft constraints still install on fewer; never block on a node-list failure.
async function warnIfFewNodesForHa(kc: KubeConfig): Promise<void> {
	try {
		const api = kc.makeApiClient(CoreV1Api);
		const nodes = await api.listNode();
		const ready = nodes.items.filter(node => node.status?.conditions?.some(cond => cond.type === 'Ready' && cond.status === 'True')).length;
		if (ready < 3) {
			p.log.warn(
				`--ha requested but only ${ready} Ready node${ready === 1 ? '' : 's'} detected. Soft constraints mean all replicas still schedule, but they won't spread until the cluster has ≥3 nodes.`
			);
		}
	} catch {
		// ignore — node listing is advisory only
	}
}

async function resolveInstallConfig(
	opts: {
		domain?: string;
		email?: string;
		registry: string;
		ha: boolean;
	},
	storage: { storageClass?: string; nodeSelector?: Record<string, string> },
	autoscaling: AutoscalingDecision | void | undefined,
	channel: Channel,
	cliVersion: string,
	platform: Platform,
	tenantPodSecurity: string,
	tenantRuntimeClass: string
): Promise<InstallConfig> {
	const inputs = await promptInstallInputs({ domain: opts.domain, email: opts.email });
	p.log.info(`Domain:  ${inputs.domain}`);
	p.log.info(`Email:   ${inputs.email}`);
	p.log.info(`Channel: ${channel}`);
	p.log.info(`Version: v${cliVersion}`);

	return {
		domain: inputs.domain,
		email: inputs.email,
		version: cliVersion,
		imageRegistry: opts.registry,
		namespace: APP_NAMESPACE,
		storageClass: storage.storageClass,
		nodeSelector: storage.nodeSelector ?? platform.nodeSelector,
		dependencies: platform.dependencies,
		ha: opts.ha,
		tenantPodSecurity,
		tenantRuntimeClass,
		dnsPolicy: dnsPolicyForPlatform(platform.id),
		...(autoscaling?.enabled ? { upcloudAutoscaling: autoscaling } : {})
	};
}

async function resolveInstallClusterIssuer(kc: KubeConfig, config: InstallConfig): Promise<InstallConfig> {
	const resolution = await resolveCertManagerClusterIssuer(kc, {
		email: config.email,
		dependencies: config.dependencies
	});

	if (resolution.action === 'reuse') {
		p.log.info(`ClusterIssuer "${resolution.clusterIssuer.name}" already exists; reusing it.`);
		if (resolution.emailMismatch && resolution.existingEmail) {
			p.log.warn(
				`ClusterIssuer "${resolution.clusterIssuer.name}" uses ACME email ${resolution.existingEmail}; requested ${config.email}. Reusing the existing issuer.`
			);
		}
	}

	return { ...config, certManagerClusterIssuer: resolution.clusterIssuer };
}

async function prepareClusterResources(kc: KubeConfig, config: InstallConfig): Promise<void> {
	await ensureNamespace(kc);
	await ensurePlatformSecrets(kc, config);
}

async function ensureNamespace(kc: KubeConfig): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);
	const spinner = p.spinner();
	spinner.start('Creating namespace...');
	try {
		await api.readNamespace({ name: APP_NAMESPACE });
		spinner.stop(`Namespace "${APP_NAMESPACE}" already exists`);
	} catch {
		await api.createNamespace({ body: { metadata: { name: APP_NAMESPACE } } });
		spinner.stop(`Namespace "${APP_NAMESPACE}" created`);
	}
}

async function ensurePlatformSecrets(kc: KubeConfig, config: InstallConfig): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Generating secrets...');
	await createSecrets(kc);
	spinner.stop('Secrets ready');

	p.log.info(`Build registry setup will continue in the Console at https://${config.domain}.`);
}

// The chart creates a CNPG Cluster CR, which helm fails the whole release on if CNPG's mutating webhook is
// not yet reachable from the apiserver. Installing the operator with helm --wait only proves its Deployment
// is Ready, not that the apiserver can reach it — on clusters with an externally hosted control plane that
// lags by tens of seconds. Runs after the namespace exists, since the probe targets it.
async function waitForDatabaseOperator(kc: KubeConfig): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Waiting for CloudNativePG to accept resources...');
	try {
		await waitForCnpgReady(kc);
		spinner.stop('CloudNativePG ready');
	} catch (err) {
		spinner.stop('CloudNativePG did not become ready');
		throw err;
	}
}

async function installChart(config: InstallConfig): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Generating values file...');
	const valuesFile = generateValuesFile(config);
	spinner.stop(`Values file created: ${valuesFile}`);

	spinner.start('helm upgrade --install (may take a few minutes)...');
	await helmUpgradeInstall(config, valuesFile);
	spinner.stop('Helm release installed');
}

async function writeInstallMarker(kc: KubeConfig, config: InstallConfig, cliVersion: string, channel: Channel, platform: Platform): Promise<void> {
	const spinner = p.spinner();
	spinner.start('Setting version marker...');
	await writeVersionMarker(kc, `v${cliVersion}`, 'cli', channel, buildInstallState(config, platform.id));
	spinner.stop('Version marker set');
}

// Deficit left unprovisioned: the cluster scales up during install, so give helm --wait more room (unless pinned).
function raiseInstallTimeoutForColdStart(): void {
	if (process.env.KUBWAVE_INSTALL_TIMEOUT?.trim()) return;
	process.env.KUBWAVE_INSTALL_TIMEOUT = '25m';
	p.log.info('Cluster is scaling up: raised the install timeout to 25m (override with KUBWAVE_INSTALL_TIMEOUT).');
}

function parseStorageMode(value: string): 'auto' | 'skip' {
	if (value === 'auto' || value === 'skip') return value;
	throw new Error(`--storage must be 'auto' or 'skip', got '${value}'`);
}

// 'off' maps to '' (clears the PSS labels); baseline/restricted pass through as the tenant namespace enforce level.
function parseTenantPodSecurity(value: string): 'baseline' | 'restricted' | '' {
	if (value === 'baseline' || value === 'restricted') return value;
	if (value === 'off') return '';
	throw new Error(`--tenant-pod-security must be 'baseline', 'restricted', or 'off', got '${value}'`);
}

// 'off' maps to '' (plain runc). Only gVisor is installable today, so reject anything else.
export function parseTenantRuntimeClass(value: string): 'gvisor' | '' {
	if (value === 'gvisor') return value;
	if (value === 'off') return '';
	throw new Error(`--tenant-runtime-class must be 'gvisor' or 'off', got '${value}'`);
}
