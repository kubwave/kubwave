import type { KubeConfig, V1Deployment, V1PriorityClass } from '@kubernetes/client-node';
import { AppsV1Api, SchedulingV1Api } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import type { Platform } from '~/lib/platforms.js';
import { execHelm } from '~/lib/helm-exec.js';
import { getChartPath } from '~/lib/embedded.js';
import { generateValuesFile } from '~/lib/helm.js';
import { APP_NAMESPACE, HELM_RELEASE_NAME } from '~/lib/constants.js';
import { buildOwnershipLabels } from '~/lib/ownership.js';
import { isAlreadyExistsError, isNotFoundError } from '~/lib/k8s-errors.js';
import { UserCancelledError } from '~/lib/errors.js';
import { addCapacity, formatCpu, formatMem, getSchedulableCapacity, sumRequestsFromManifests, type Capacity } from '~/lib/capacity.js';

const PRIMER_NAME = 'kubwave-node-primer';
const PRIMER_NAMESPACE = 'default';
const PAUSE_IMAGE = 'registry.k8s.io/pause:3.9';

// Each primer pod reserves this much, so Karpenter provisions modest, widely-available instance types rather
// than one oversized node. Node count = ceil(deficit / this), so total provisioned capacity covers the deficit.
const PRIMER_POD_CPU_MILLIS = 1000;
const PRIMER_POD_MEM_BYTES = 2 * 2 ** 30;

// Headroom over the summed platform requests: the Traefik/cert-manager dependencies installed right after
// warm-up, plus per-node kube-system/CSI DaemonSet overhead on freshly provisioned nodes.
const HEADROOM_FACTOR = 1.25;
const DEPENDENCY_ALLOWANCE: Capacity = { cpuMillis: 400, memBytes: 512 * 2 ** 20 };

// Used only when `helm template` can't render (e.g. embedded chart missing); biased high so the primer never
// under-provisions. HA replicates api/console/worker + the CNPG database.
const FALLBACK_BASE: Capacity = { cpuMillis: 900, memBytes: 2 * 2 ** 30 };
const FALLBACK_HA: Capacity = { cpuMillis: 2600, memBytes: 5 * 2 ** 30 };

const DEFAULT_WARMUP_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

export interface WarmupResult {
	// A primer ran to completion (nodes provisioned) — the install can use the normal timeout.
	warmed: boolean;
	// Capacity was short. When true but warmed is false, the caller should raise the install timeout instead.
	deficit: boolean;
	// Call only after the real workloads are scheduled — the primer holds the nodes until then.
	cleanup: () => Promise<void>;
}

const NOOP_CLEANUP = async (): Promise<void> => {};

export interface WarmupPlan {
	deficit: Capacity;
	replicas: number;
	perPod: Capacity;
}

export function planWarmup(required: Capacity, available: Capacity, ha: boolean): WarmupPlan | null {
	const deficitCpu = Math.max(0, required.cpuMillis - available.cpuMillis);
	const deficitMem = Math.max(0, required.memBytes - available.memBytes);
	if (deficitCpu === 0 && deficitMem === 0) return null;
	const replicas = Math.max(ha ? 3 : 1, Math.ceil(deficitCpu / PRIMER_POD_CPU_MILLIS), Math.ceil(deficitMem / PRIMER_POD_MEM_BYTES));
	return {
		deficit: { cpuMillis: deficitCpu, memBytes: deficitMem },
		replicas,
		perPod: { cpuMillis: PRIMER_POD_CPU_MILLIS, memBytes: PRIMER_POD_MEM_BYTES }
	};
}

export async function computeRequiredCapacity(opts: { ha: boolean; nodeSelector: Record<string, string> }): Promise<Capacity> {
	const rendered = await renderChartRequests(opts);
	const base = rendered ?? (opts.ha ? FALLBACK_HA : FALLBACK_BASE);
	const withDeps = addCapacity(base, DEPENDENCY_ALLOWANCE);
	return { cpuMillis: Math.ceil(withDeps.cpuMillis * HEADROOM_FACTOR), memBytes: Math.ceil(withDeps.memBytes * HEADROOM_FACTOR) };
}

async function renderChartRequests(opts: { ha: boolean; nodeSelector: Record<string, string> }): Promise<Capacity | null> {
	try {
		const valuesFile = generateValuesFile({
			domain: 'warmup.invalid',
			email: 'warmup@invalid',
			version: 'dev',
			imageRegistry: 'registry.invalid',
			namespace: APP_NAMESPACE,
			nodeSelector: opts.nodeSelector,
			ha: opts.ha
		});
		const { stdout, exitCode } = await execHelm(['template', HELM_RELEASE_NAME, getChartPath(), '-f', valuesFile]);
		if (exitCode !== 0) return null;
		const sum = sumRequestsFromManifests(stdout);
		return sum.cpuMillis > 0 ? sum : null;
	} catch {
		return null;
	}
}

export async function warmNodes(
	kc: KubeConfig,
	platform: Platform,
	opts: { ha: boolean; assumeYes: boolean; enabled: boolean }
): Promise<WarmupResult> {
	if (!opts.enabled) return { warmed: false, deficit: false, cleanup: NOOP_CLEANUP };
	const nodeSelector = platform.nodeSelector ?? {};
	if (Object.keys(nodeSelector).length === 0) return { warmed: false, deficit: false, cleanup: NOOP_CLEANUP };

	const spinner = p.spinner();
	spinner.start('Checking cluster capacity...');
	let required: Capacity;
	let available: Awaited<ReturnType<typeof getSchedulableCapacity>>;
	try {
		required = await computeRequiredCapacity({ ha: opts.ha, nodeSelector });
		available = await getSchedulableCapacity(kc, nodeSelector);
	} catch (err) {
		spinner.stop('Capacity check skipped.');
		p.log.warn(`Could not assess cluster capacity: ${err instanceof Error ? err.message : String(err)}. Continuing without node warm-up.`);
		return { warmed: false, deficit: false, cleanup: NOOP_CLEANUP };
	}
	spinner.stop('Capacity check complete');

	p.log.info(`Required (with headroom): ${formatCpu(required.cpuMillis)} CPU / ${formatMem(required.memBytes)}`);
	p.log.info(
		`Available on ${available.readyNodes} Ready node(s) [${selectorText(nodeSelector)}]: ${formatCpu(available.capacity.cpuMillis)} CPU / ${formatMem(available.capacity.memBytes)}`
	);

	const plan = planWarmup(required, available.capacity, opts.ha);
	if (!plan) {
		p.log.success('Capacity sufficient — no node warm-up needed.');
		return { warmed: false, deficit: false, cleanup: NOOP_CLEANUP };
	}

	p.log.warn(
		`Capacity short by ${formatCpu(plan.deficit.cpuMillis)} CPU / ${formatMem(plan.deficit.memBytes)}. The cluster must scale up before install, or helm --wait may time out.`
	);

	if (!opts.assumeYes) {
		const ok = await p.confirm({
			message: `Warm up ${plan.replicas} node(s) now with temporary pods so the install does not time out while the cluster scales?`
		});
		if (p.isCancel(ok)) throw new UserCancelledError('Node warm-up cancelled.');
		if (!ok) {
			p.log.info('Skipping node warm-up; the install timeout will be raised instead.');
			return { warmed: false, deficit: true, cleanup: NOOP_CLEANUP };
		}
	}

	const completed = await startPrimer(kc, { nodeSelector, replicas: plan.replicas, perPod: plan.perPod });
	// Keep the primer running so its nodes aren't consolidated away before the real pods land; real (default-priority)
	// workloads preempt the negative-priority primer, and cleanup removes whatever is left.
	return { warmed: completed, deficit: true, cleanup: () => cleanupPrimer(kc) };
}

async function startPrimer(kc: KubeConfig, cfg: { nodeSelector: Record<string, string>; replicas: number; perPod: Capacity }): Promise<boolean> {
	const apps = kc.makeApiClient(AppsV1Api);
	const spinner = p.spinner();
	spinner.start(`Warming up ${cfg.replicas} node(s) (provisioning capacity, may take a few minutes)...`);
	try {
		await ensurePrimerPriorityClass(kc);
		await applyPrimerDeployment(apps, cfg);
		await waitForDeploymentAvailable(apps, cfg.replicas, warmupTimeoutMs());
		spinner.stop(`Nodes warmed up — ${cfg.replicas} primer pod(s) Running.`);
		return true;
	} catch (err) {
		spinner.stop('Node warm-up did not complete.');
		p.log.warn(`Warm-up incomplete: ${err instanceof Error ? err.message : String(err)}. Continuing; the install timeout will be raised.`);
		return false;
	}
}

async function cleanupPrimer(kc: KubeConfig): Promise<void> {
	await deletePrimer(kc.makeApiClient(AppsV1Api));
	try {
		await kc.makeApiClient(SchedulingV1Api).deletePriorityClass({ name: PRIMER_NAME });
	} catch (err) {
		if (!isNotFoundError(err)) {
			p.log.warn(`Could not remove the node-primer PriorityClass ${PRIMER_NAME}: ${err instanceof Error ? err.message : String(err)}.`);
		}
	}
}

async function ensurePrimerPriorityClass(kc: KubeConfig): Promise<void> {
	const body: V1PriorityClass = {
		metadata: { name: PRIMER_NAME, labels: buildOwnershipLabels({ component: 'platform', instance: 'node-primer', cliManaged: true }) },
		value: -1,
		preemptionPolicy: 'Never',
		globalDefault: false,
		description: 'kubwave node warm-up primer; preempted by real workloads.'
	};
	try {
		await kc.makeApiClient(SchedulingV1Api).createPriorityClass({ body });
	} catch (err) {
		if (!isAlreadyExistsError(err)) throw err;
	}
}

async function applyPrimerDeployment(
	apps: AppsV1Api,
	cfg: { nodeSelector: Record<string, string>; replicas: number; perPod: Capacity }
): Promise<void> {
	const labels = { app: PRIMER_NAME, ...buildOwnershipLabels({ component: 'platform', instance: 'node-primer', cliManaged: true }) };
	const body: V1Deployment = {
		apiVersion: 'apps/v1',
		kind: 'Deployment',
		metadata: { name: PRIMER_NAME, namespace: PRIMER_NAMESPACE, labels },
		spec: {
			replicas: cfg.replicas,
			selector: { matchLabels: { app: PRIMER_NAME } },
			template: {
				metadata: { labels: { app: PRIMER_NAME } },
				spec: {
					nodeSelector: cfg.nodeSelector,
					priorityClassName: PRIMER_NAME,
					terminationGracePeriodSeconds: 0,
					affinity: {
						podAntiAffinity: {
							preferredDuringSchedulingIgnoredDuringExecution: [
								{ weight: 100, podAffinityTerm: { topologyKey: 'kubernetes.io/hostname', labelSelector: { matchLabels: { app: PRIMER_NAME } } } }
							]
						}
					},
					containers: [
						{
							name: 'pause',
							image: PAUSE_IMAGE,
							resources: { requests: { cpu: formatCpu(cfg.perPod.cpuMillis), memory: formatMem(cfg.perPod.memBytes) } }
						}
					]
				}
			}
		}
	};
	try {
		await apps.createNamespacedDeployment({ namespace: PRIMER_NAMESPACE, body });
	} catch (err) {
		if (!isAlreadyExistsError(err)) throw err;
		// A leftover primer from an aborted run — replace it so replica count and pod shape match this plan.
		await apps.replaceNamespacedDeployment({ namespace: PRIMER_NAMESPACE, name: PRIMER_NAME, body });
	}
}

async function waitForDeploymentAvailable(apps: AppsV1Api, replicas: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const dep = await apps.readNamespacedDeployment({ namespace: PRIMER_NAMESPACE, name: PRIMER_NAME });
		if ((dep.status?.availableReplicas ?? 0) >= replicas) return;
		if (Date.now() >= deadline) {
			throw new Error(
				`only ${dep.status?.availableReplicas ?? 0}/${replicas} primer pod(s) became Ready before the ${Math.round(timeoutMs / 60000)}m timeout`
			);
		}
		await sleep(POLL_INTERVAL_MS);
	}
}

async function deletePrimer(apps: AppsV1Api): Promise<void> {
	try {
		await apps.deleteNamespacedDeployment({ namespace: PRIMER_NAMESPACE, name: PRIMER_NAME, propagationPolicy: 'Foreground' });
	} catch (err) {
		if (!isNotFoundError(err)) {
			p.log.warn(
				`Could not remove the node-primer deployment ${PRIMER_NAMESPACE}/${PRIMER_NAME}: ${err instanceof Error ? err.message : String(err)}. Delete it manually.`
			);
		}
	}
}

function warmupTimeoutMs(): number {
	const raw = process.env.KUBWAVE_WARMUP_TIMEOUT?.trim();
	if (!raw) return DEFAULT_WARMUP_TIMEOUT_MS;
	const m = raw.match(/^(\d+)(m|s)?$/);
	if (!m) return DEFAULT_WARMUP_TIMEOUT_MS;
	const n = parseInt(m[1] ?? '', 10);
	return m[2] === 's' ? n * 1000 : n * 60 * 1000;
}

function selectorText(selector: Record<string, string>): string {
	return Object.entries(selector)
		.map(([k, v]) => `${k}=${v}`)
		.join(',');
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
