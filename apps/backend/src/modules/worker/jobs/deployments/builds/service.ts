import { BatchV1Api, CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import type { KubeConfig, V1Job, V1Pod } from '@kubernetes/client-node';
import type { DeploymentLogEntry, RuntimeConfig } from '@kubwave/db';
import { LABEL_MANAGED_BY, LABEL_SERVICE_ID, MANAGED_BY_VALUE } from '@kubwave/kube';
import { deleteIgnoreMissing, notFoundToNull } from '../../../../../shared/cluster/ops.js';
import { stepEvent } from '../../../../../shared/cluster/networking.js';
import { reconcileRuntime } from '../deployers/runtime/runtime.service.js';
import type { DeployContext, ReconcileResult } from '../deployers/types.js';
import { env } from '../../../../../shared/config/worker-env.js';
import { registryAuthHeaders } from '../../registry/auth.js';
import { buildCacheRef } from './buildkit.js';
import { persistDeploymentImageRef } from '../image-ref.js';

// Shared build-Job machinery for all build types; component label selects objects for reap/prune sweeps, deployment-id ties an object to its build attempt.
export const LABEL_COMPONENT = 'app.kubernetes.io/component';
export const LABEL_DEPLOYMENT_ID = 'kubwave/deployment-id';
export const COMPONENT_BUILDER = 'builder';
// Selector for every build Job/ConfigMap/Secret/NetworkPolicy in the platform namespace (used by teardown + GC).
export const BUILDER_LABEL_SELECTOR = `${LABEL_COMPONENT}=${COMPONENT_BUILDER}`;
export { BUILDER_CONTAINER, buildCacheRef } from './buildkit.js';

// Repo scoped per service (env-<id>/svc-<id>) for retention; tag is the deployment id (immutable per attempt -> idempotency + clean rollback).
export function buildImageRef(registryEndpoint: string, environmentId: string, serviceId: string, deploymentId: string): string {
	return `${registryEndpoint}/env-${environmentId}/svc-${serviceId}:${deploymentId}`;
}

export function buildJobLabels(serviceId: string, deploymentId: string): Record<string, string> {
	return {
		[LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
		[LABEL_COMPONENT]: COMPONENT_BUILDER,
		[LABEL_SERVICE_ID]: serviceId,
		[LABEL_DEPLOYMENT_ID]: deploymentId
	};
}

// Best-effort reap of every build Job for a service: catches in-flight builds at service-delete time that TTL would otherwise leave lingering.
export async function reapBuildJobs(batchApi: BatchV1Api, serviceId: string): Promise<void> {
	const selector = `${BUILDER_LABEL_SELECTOR},${LABEL_SERVICE_ID}=${serviceId}`;

	await deleteIgnoreMissing(async () => {
		const jobs = await batchApi.listNamespacedJob({ namespace: env.podNamespace, labelSelector: selector });

		for (const j of jobs.items) {
			if (j.metadata?.name)
				await deleteIgnoreMissing(() =>
					batchApi.deleteNamespacedJob({ name: j.metadata!.name!, namespace: env.podNamespace, propagationPolicy: 'Background' })
				);
		}
	});
}

export async function deleteBuildArtifactsForDeployment(kc: KubeConfig, deploymentId: string): Promise<void> {
	const namespace = env.podNamespace;
	const selector = `${BUILDER_LABEL_SELECTOR},${LABEL_DEPLOYMENT_ID}=${deploymentId}`;
	const batchApi = kc.makeApiClient(BatchV1Api);
	const coreApi = kc.makeApiClient(CoreV1Api);
	const netApi = kc.makeApiClient(NetworkingV1Api);

	await deleteIgnoreMissing(async () => {
		const jobs = await batchApi.listNamespacedJob({ namespace, labelSelector: selector });
		for (const j of jobs.items) {
			if (j.metadata?.name)
				await deleteIgnoreMissing(() => batchApi.deleteNamespacedJob({ name: j.metadata!.name!, namespace, propagationPolicy: 'Background' }));
		}
	});
	await deleteIgnoreMissing(async () => {
		const configMaps = await coreApi.listNamespacedConfigMap({ namespace, labelSelector: selector });
		for (const cm of configMaps.items) {
			if (cm.metadata?.name) await deleteIgnoreMissing(() => coreApi.deleteNamespacedConfigMap({ name: cm.metadata!.name!, namespace }));
		}
	});
	await deleteIgnoreMissing(async () => {
		const secrets = await coreApi.listNamespacedSecret({ namespace, labelSelector: selector });
		for (const s of secrets.items) {
			if (s.metadata?.name) await deleteIgnoreMissing(() => coreApi.deleteNamespacedSecret({ name: s.metadata!.name!, namespace }));
		}
	});
	await deleteIgnoreMissing(async () => {
		const policies = await netApi.listNamespacedNetworkPolicy({ namespace, labelSelector: selector });
		for (const policy of policies.items) {
			if (policy.metadata?.name) await deleteIgnoreMissing(() => netApi.deleteNamespacedNetworkPolicy({ name: policy.metadata!.name!, namespace }));
		}
	});
}

export async function hasRunningBuildJobForDeployment(kc: KubeConfig, deploymentId: string): Promise<boolean> {
	const namespace = env.podNamespace;
	const selector = `${BUILDER_LABEL_SELECTOR},${LABEL_DEPLOYMENT_ID}=${deploymentId}`;
	const batchApi = kc.makeApiClient(BatchV1Api);
	const jobs = await notFoundToNull(() => batchApi.listNamespacedJob({ namespace, labelSelector: selector }));

	return (jobs?.items ?? []).some(job => jobStatus(job) === 'running');
}

export function readJobOrNull(api: BatchV1Api, namespace: string, name: string): Promise<V1Job | null> {
	return notFoundToNull(() => api.readNamespacedJob({ name, namespace }));
}

export async function readBuildPod(api: CoreV1Api, namespace: string, jobName: string): Promise<V1Pod | null> {
	const pods = await api.listNamespacedPod({ namespace, labelSelector: `job-name=${jobName}` });

	return pods.items[0] ?? null;
}

async function captureBuildLogsBestEffort(args: {
	api: CoreV1Api;
	namespace: string;
	jobName: string;
	deploymentId: string;
	containers: string[];
}): Promise<void> {
	try {
		const { captureBuildLogs } = await import('./logs.js');
		await captureBuildLogs(args);
	} catch {
		// Persisting logs is best-effort and must never affect deployment progress.
	}
}

export function jobStatus(job: V1Job): 'running' | 'succeeded' | 'failed' {
	const s = job.status;

	if ((s?.succeeded ?? 0) >= 1) return 'succeeded';
	if ((s?.conditions ?? []).some(c => c.type === 'Failed' && c.status === 'True')) return 'failed';
	if ((s?.failed ?? 0) >= 1) return 'failed';

	return 'running';
}

// BuildKit's terminal `error: failed to solve … exit code: 1` hides the real cause; the actual command output is what we want, not the wrapper.
function isGenericBuildkitError(line: string): boolean {
	return /failed to solve|did not complete successfully/i.test(line);
}

// Strip BuildKit's `#12 ` marker and `12.34 ` elapsed stamp; the stamp regex requires the decimal so a real `404 …`/`2 errors …` line isn't truncated.
function stripStepPrefix(line: string): string {
	return line.replace(/^#\d+\s+/, '').replace(/^\d+\.\d+\s/, '');
}

// On a failed RUN, BuildKit echoes the step's tail output between `------` fences under a `> [stage] RUN …:` header. That block is the real error; return it if present.
function extractBuildkitFailureBlock(lines: string[]): string | null {
	const fences = lines.reduce<number[]>((acc, l, i) => (/^-{6,}$/.test(l.trim()) ? [...acc, i] : acc), []);

	for (let f = fences.length - 1; f >= 1; f--) {
		const start = fences[f - 1];
		const end = fences[f];
		if (start === undefined || end === undefined) continue;
		const header = lines[start + 1]?.trim() ?? '';
		if (!/^>\s/.test(header)) continue;

		const body = lines
			.slice(start + 2, end)
			.map(stripStepPrefix)
			.map(l => l.trimEnd())
			.filter(Boolean);
		if (body.length === 0) continue;

		const step = header
			.replace(/^>\s*/, '')
			.replace(/:\s*$/, '')
			.replace(/^\[[^\]]*\]\s*/, '');

		return [step, ...body.slice(-12)].join('\n').slice(0, 2000);
	}

	return null;
}

// Collapse build output to the real cause: prefer BuildKit's failing-step block, then a non-generic `Error:` line, else drop a trailing cobra `Usage:` block, else tail. Capped to 2000 chars.
export function summarizeBuildLog(raw: string): string {
	const lines = raw.split('\n');

	const fenced = extractBuildkitFailureBlock(lines);
	if (fenced) return fenced;

	const errLine = lines.find(l => /^\s*(error[:\s]|fatal[:\s])/i.test(l) && !isGenericBuildkitError(l));
	if (errLine) return errLine.trim();

	const usageAt = lines.findIndex(l => l.trim() === 'Usage:');
	const kept = (usageAt >= 0 ? lines.slice(0, usageAt) : lines)
		.map(stripStepPrefix)
		.map(l => l.trimEnd())
		.filter(l => l && !isGenericBuildkitError(l));

	return kept.slice(-12).join('\n').slice(0, 2000);
}

// Failure detail from whichever container terminated non-zero (the real cause); `containers` are in run order, falls back to the last.
export async function buildFailureReason(api: CoreV1Api, namespace: string, jobName: string, containers: string[]): Promise<string> {
	const pod = await readBuildPod(api, namespace, jobName);

	if (!pod) return 'Build failed';

	const statuses = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])];
	const failed = statuses.find(c => containers.includes(c.name) && c.state?.terminated && c.state.terminated.exitCode !== 0);
	const target = failed?.name ?? containers[containers.length - 1];
	const podName = pod.metadata?.name;

	if (podName && target) {
		try {
			const log = await api.readNamespacedPodLog({ name: podName, namespace, container: target, tailLines: 100 });
			const summary = summarizeBuildLog(typeof log === 'string' ? log : '');

			if (summary) return `Build failed:\n${summary}`;
		} catch {
			// Log unavailable (pod gone / not started) - fall through to the terminated state.
		}
	}

	// Fall back to the failed (or target) container's terminated state - e.g. an activeDeadlineSeconds kill - so a real reason surfaces.
	const term = (failed ?? statuses.find(c => c.name === target))?.state?.terminated;

	if (term?.message) return `Build failed: ${term.message}`;
	if (term?.reason) return `Build failed: ${term.reason}${term.exitCode != null ? ` (exit ${term.exitCode})` : ''}`;

	return 'Build failed';
}

// Shared build->deploy state machine driven off observed cluster state (idempotent, re-claim safe); per-type differences passed in.
export async function runBuildReconcile(
	ctx: DeployContext,
	config: RuntimeConfig,
	opts: {
		jobName: string;
		buildContainers: string[];
		startMessage: string;
		notConfiguredError: string;
		validateBuildConfig?: () => string | null;
		startBuild: (args: {
			coreApi: CoreV1Api;
			batchApi: BatchV1Api;
			namespace: string;
			imageRef: string;
			// BuildKit registry cache ref so repeated builds reuse unchanged layers.
			cacheRef: string;
			serviceId: string;
			deploymentId: string;
		}) => Promise<void>;
	}
): Promise<ReconcileResult> {
	const serviceId = ctx.deployment.serviceId;
	const deploymentId = ctx.deployment.id;
	const rollbackOnly = ctx.buildMode === 'rollback';
	const storedImageRef = ctx.deployment.imageRef?.trim() || null;

	if (rollbackOnly) {
		const imageRef =
			storedImageRef ?? (env.registryEndpoint ? buildImageRef(env.registryEndpoint, ctx.environmentId, serviceId, deploymentId) : null);
		if (!imageRef || (!storedImageRef && !(await imageExists(imageRef)))) {
			return {
				state: 'failed',
				error: `Rollback target ${deploymentId} has no recorded image reference; deploy a new version before cancel rollback can restore it.`
			};
		}

		if (!storedImageRef) await persistDeploymentImageRef(deploymentId, imageRef);
		const result = await reconcileRuntime(ctx, config, imageRef);
		return result;
	}

	if (!storedImageRef && !env.registryEndpoint) return { state: 'failed', error: opts.notConfiguredError };

	const namespace = env.podNamespace;
	const imageRef = storedImageRef ?? buildImageRef(env.registryEndpoint, ctx.environmentId, serviceId, deploymentId);
	if (!storedImageRef) await persistDeploymentImageRef(deploymentId, imageRef);
	const cacheRef = env.registryEndpoint ? buildCacheRef(env.registryEndpoint, ctx.environmentId, serviceId) : null;
	const coreApi = ctx.kc.makeApiClient(CoreV1Api);
	const batchApi = ctx.kc.makeApiClient(BatchV1Api);
	const events: DeploymentLogEntry[] = [];

	// Phase A: build the image (unless it already exists for this attempt).
	const job = await readJobOrNull(batchApi, namespace, opts.jobName);

	if (job) {
		await captureBuildLogsBestEffort({ api: coreApi, namespace, jobName: opts.jobName, deploymentId, containers: opts.buildContainers });

		const status = jobStatus(job);

		if (status === 'running')
			return {
				state: 'progressing',
				phase: 'building',
				events
			};

		if (status === 'failed')
			return {
				state: 'failed',
				error: await buildFailureReason(coreApi, namespace, opts.jobName, opts.buildContainers),
				events
			};

		// Succeeded -> image pushed. Surface the build->deploy transition exactly once (only on the tick we leave `building`).
		if (ctx.deployment.phase === 'building') {
			events.push(stepEvent('build-succeeded', `Built and pushed image ${imageRef}`));
			events.push(stepEvent('image-ready', 'Image ready - applying manifests'));
		}
	} else if (!(await imageExists(imageRef))) {
		// No build Job and no image yet -> start the build (an existing image, e.g. re-deploy/rollback, skips straight to deploy).
		if (!cacheRef) return { state: 'failed', error: opts.notConfiguredError };
		const validationError = opts.validateBuildConfig?.();
		if (validationError) return { state: 'failed', error: validationError };
		await opts.startBuild({ coreApi, batchApi, namespace, imageRef, cacheRef, serviceId, deploymentId });
		events.push(stepEvent('build-started', `${opts.startMessage} (${opts.jobName})`));

		return {
			state: 'progressing',
			phase: 'building',
			events
		};
	}

	// Phase B: deploy the built image through the shared runtime core.
	const result = await reconcileRuntime(ctx, config, imageRef);

	return { ...result, events: [...events, ...(result.events ?? [])] };
}

function splitImageRef(ref: string): { host: string; repo: string; tag: string } | null {
	const slash = ref.indexOf('/');

	if (slash < 0) return null;

	const host = ref.slice(0, slash);
	const rest = ref.slice(slash + 1);
	const colon = rest.lastIndexOf(':');

	if (colon < 0) return null;

	return { host, repo: rest.slice(0, colon), tag: rest.slice(colon + 1) };
}

// Registry v2 manifest HEAD to skip a rebuild on re-deploy/rollback; a false negative just triggers a harmless rebuild, so errors resolve to false.
export async function imageExists(imageRef: string): Promise<boolean> {
	const parsed = splitImageRef(imageRef);

	if (!parsed) return false;

	const scheme = env.registryInsecure ? 'http' : 'https';
	const url = `${scheme}://${parsed.host}/v2/${parsed.repo}/manifests/${parsed.tag}`;

	try {
		const res = await fetch(url, {
			method: 'HEAD',
			headers: {
				Accept:
					'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json',
				...(await registryAuthHeaders())
			},
			signal: AbortSignal.timeout(5000)
		});

		return res.status === 200;
	} catch {
		return false;
	}
}
