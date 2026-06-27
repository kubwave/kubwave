import { Writable } from 'node:stream';
import { CoreV1Api, Exec, type KubeConfig, type V1Pod, type V1Status } from '@kubernetes/client-node';
import { and, eq, inArray } from 'drizzle-orm';
import { db, deployments } from '@kubwave/db';
import { getKubeConfig } from '@kubwave/kube';
import { env } from '../../../../shared/config/worker-env.js';
import { BUILD_ACTIVE_STATUSES } from '../deployments/types.js';

// Reaps unreferenced blobs the prune sweep freed. registry:2 has no online GC, so we exec `registry garbage-collect` in the live pod.
// Gated on "no builds in flight" to shrink (not close) the mark-then-sweep race; no-op when the registry pod is absent (dev / external registry).

const REGISTRY_POD_SELECTOR = 'app.kubernetes.io/name=registry';
const REGISTRY_CONTAINER = 'registry';
// Stock config path baked into the registry:2 image (chart configures via env vars only).
const REGISTRY_CONFIG_PATH = '/etc/docker/registry/config.yml';

export type GcOutcome = 'disabled' | 'no-pod' | 'gated' | 'ok' | 'failed';

// `-m` (--delete-untagged) drops untagged manifests; BuildKit pushes one per target platform here, and prune keeps the reserved registry-cache tag.
export function buildGcCommand(): string[] {
	return ['registry', 'garbage-collect', '-m', REGISTRY_CONFIG_PATH];
}

// Pick a Running registry pod (the Deployment is replicas:1 with Recreate, so there's at most one).
export function selectRegistryPod(pods: V1Pod[]): string | null {
	const running = pods.find(p => p.status?.phase === 'Running' && p.metadata?.name);
	return running?.metadata?.name ?? null;
}

// exec delivers exit status via V1Status callback. Treat ambiguous runs as failure.
export function parseExecSuccess(status: V1Status | undefined): boolean {
	return status?.status === 'Success';
}

interface ExecResult {
	success: boolean;
	output: string;
}

// Run a command in a pod container, capturing combined stdout+stderr and the exit status.
async function execInPod(kc: KubeConfig, namespace: string, pod: string, container: string, command: string[]): Promise<ExecResult> {
	const exec = new Exec(kc);
	let captured = '';
	const sink = new Writable({
		write(chunk, _enc, cb) {
			captured += chunk.toString();
			cb();
		}
	});
	return await new Promise<ExecResult>((resolve, reject) => {
		let status: V1Status | undefined;
		exec
			.exec(namespace, pod, container, command, sink, sink, null, false, s => {
				status = s;
			})
			.then(ws => {
				ws.on('close', () => resolve({ success: parseExecSuccess(status), output: captured.trim() }));
				ws.on('error', reject);
			})
			.catch(reject);
	});
}

// Count Dockerfile deployments that could currently be pushing to the registry (the build gate).
async function buildsInFlight(): Promise<number> {
	const rows = await db
		.select({ id: deployments.id })
		.from(deployments)
		.where(and(eq(deployments.type, 'dockerfile'), inArray(deployments.status, [...BUILD_ACTIVE_STATUSES])));
	return rows.length;
}

// Injectable seams for unit testing; production calls use the real implementations.
export interface GcDeps {
	kc?: KubeConfig;
	findRegistryPod?: (coreApi: CoreV1Api, namespace: string) => Promise<string | null>;
	countBuildsInFlight?: () => Promise<number>;
	exec?: (kc: KubeConfig, namespace: string, pod: string, container: string, command: string[]) => Promise<ExecResult>;
}

async function defaultFindRegistryPod(coreApi: CoreV1Api, namespace: string): Promise<string | null> {
	const pods = await coreApi.listNamespacedPod({ namespace, labelSelector: REGISTRY_POD_SELECTOR });
	return selectRegistryPod(pods.items);
}

export async function garbageCollectRegistry(deps: GcDeps = {}): Promise<GcOutcome> {
	if (!env.registryGcEnabled || !env.registryEndpoint) return 'disabled';

	const kc = deps.kc ?? getKubeConfig();
	const coreApi = kc.makeApiClient(CoreV1Api);
	const findPod = deps.findRegistryPod ?? defaultFindRegistryPod;
	const pod = await findPod(coreApi, env.podNamespace);
	if (!pod) return 'no-pod'; // dev (external registry) or registry disabled -> nothing to do

	const countBuilds = deps.countBuildsInFlight ?? buildsInFlight;
	const inflight = await countBuilds();
	if (inflight > 0) {
		console.log(`[registry-gc] skipped: ${inflight} build(s) in flight (GC races concurrent pushes)`);
		return 'gated';
	}

	console.log('[registry-gc] running garbage-collect...');
	const run = deps.exec ?? execInPod;
	const res = await run(kc, env.podNamespace, pod, REGISTRY_CONTAINER, buildGcCommand());
	if (res.success) {
		console.log('[registry-gc] garbage-collect complete');
		return 'ok';
	}
	console.warn(`[registry-gc] garbage-collect failed:${res.output ? `\n${res.output}` : ''}`);
	return 'failed';
}
