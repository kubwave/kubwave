import type {
	AppsV1Api,
	AutoscalingV2Api,
	CoreV1Api,
	NetworkingV1Api,
	V1ConfigMap,
	V1Deployment,
	V1Ingress,
	V1NetworkPolicy,
	V1PersistentVolumeClaim,
	V1Secret,
	V1Service,
	V2HorizontalPodAutoscaler
} from '@kubernetes/client-node';
import type { DeploymentLogEntry } from '@kubwave/db';
import { isConflict, isNotFound, LABEL_SERVICE_ID } from '@kubwave/kube';

export { isConflict, isNotFound };

const DEFAULT_RETRY_ATTEMPTS = 3;

export type ManagedSecretAction = 'created' | 'updated' | 'removed';

// Idempotent converge of a worker-managed Secret; shared by the env/config-file/pull deployers, which differ only in build/match/event.
export async function convergeManagedSecret(
	api: CoreV1Api,
	namespace: string,
	name: string,
	args: {
		isEmpty: boolean;
		build: () => V1Secret;
		matches: (existing: V1Secret, desired: V1Secret) => boolean;
		event: (action: ManagedSecretAction) => DeploymentLogEntry;
		events: DeploymentLogEntry[];
	}
): Promise<void> {
	const existing = await readSecretOrNull(api, namespace, name);

	if (args.isEmpty) {
		if (existing) {
			await deleteIgnoreMissing(() => api.deleteNamespacedSecret({ name, namespace }));
			args.events.push(args.event('removed'));
		}
		return;
	}

	if (!existing) {
		await api.createNamespacedSecret({ namespace, body: args.build() });
		args.events.push(args.event('created'));
		return;
	}

	if (!args.matches(existing, args.build())) {
		await replaceWithRetry({
			label: `Secret ${name}`,
			read: () => readSecretOrNull(api, namespace, name),
			build: args.build,
			carryOver: (fresh, body) => {
				body.metadata = { ...body.metadata, resourceVersion: fresh.metadata?.resourceVersion ?? undefined };
				return body;
			},
			replace: body => api.replaceNamespacedSecret({ name, namespace, body })
		});
		args.events.push(args.event('updated'));
	}
}

export async function replaceWithRetry<TBody extends { metadata?: { resourceVersion?: string | null } | null }>(args: {
	label: string;
	read: () => Promise<TBody | null>;
	build: () => TBody;
	carryOver: (fresh: TBody, desired: TBody) => TBody;
	replace: (body: TBody) => Promise<unknown>;
	maxAttempts?: number;
}): Promise<void> {
	const maxAttempts = args.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS;
	let lastConflict: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const fresh = await args.read();
		if (!fresh) throw new Error(`${args.label} disappeared during replace retry`);
		const body = args.carryOver(fresh, args.build());
		try {
			await args.replace(body);
			return;
		} catch (err) {
			if (!isConflict(err)) throw err;
			lastConflict = err;
		}
	}
	throw lastConflict;
}

// Run a read and fold a 404 into `null`, rethrowing anything else.
export async function notFoundToNull<T>(fn: () => Promise<T>): Promise<T | null> {
	try {
		return await fn();
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

// Container `waiting` reasons that mean the rollout will never succeed on its own.
const BAD_WAITING_REASONS = new Set([
	'ImagePullBackOff',
	'ErrImagePull',
	'CrashLoopBackOff',
	'CreateContainerConfigError',
	'InvalidImageName',
	'RunContainerError'
]);

// Read-or-null; re-writing an unchanged Deployment every tick bumps generation forever and makes the rollout look perpetually in-progress.
export function readDeploymentOrNull(api: AppsV1Api, namespace: string, name: string): Promise<V1Deployment | null> {
	return notFoundToNull(() => api.readNamespacedDeployment({ name, namespace }));
}

export function readServiceOrNull(api: CoreV1Api, namespace: string, name: string): Promise<V1Service | null> {
	return notFoundToNull(() => api.readNamespacedService({ name, namespace }));
}

export function readConfigMapOrNull(api: CoreV1Api, namespace: string, name: string): Promise<V1ConfigMap | null> {
	return notFoundToNull(() => api.readNamespacedConfigMap({ name, namespace }));
}

export function readIngressOrNull(api: NetworkingV1Api, namespace: string, name: string): Promise<V1Ingress | null> {
	return notFoundToNull(() => api.readNamespacedIngress({ name, namespace }));
}

export function readNetworkPolicyOrNull(api: NetworkingV1Api, namespace: string, name: string): Promise<V1NetworkPolicy | null> {
	return notFoundToNull(() => api.readNamespacedNetworkPolicy({ name, namespace }));
}

export function readPVCOrNull(api: CoreV1Api, namespace: string, name: string): Promise<V1PersistentVolumeClaim | null> {
	return notFoundToNull(() => api.readNamespacedPersistentVolumeClaim({ name, namespace }));
}

export function readSecretOrNull(api: CoreV1Api, namespace: string, name: string): Promise<V1Secret | null> {
	return notFoundToNull(() => api.readNamespacedSecret({ name, namespace }));
}

export function readHPAOrNull(api: AutoscalingV2Api, namespace: string, name: string): Promise<V2HorizontalPodAutoscaler | null> {
	return notFoundToNull(() => api.readNamespacedHorizontalPodAutoscaler({ name, namespace }));
}

export function rolloutFailureMessage(dep: V1Deployment): string {
	const progressing = dep.status?.conditions?.find(c => c.type === 'Progressing');
	return progressing?.message ?? 'rollout failed';
}

// Inspects the service's pods for a terminal container problem; returns a reason, or null if healthy.
export async function unhealthyReason(api: CoreV1Api, namespace: string, serviceId: string): Promise<string | null> {
	const pods = await api.listNamespacedPod({ namespace, labelSelector: `${LABEL_SERVICE_ID}=${serviceId}` });
	for (const pod of pods.items) {
		for (const cs of pod.status?.containerStatuses ?? []) {
			const waiting = cs.state?.waiting;
			if (waiting?.reason && BAD_WAITING_REASONS.has(waiting.reason)) {
				return `${waiting.reason}: ${waiting.message ?? cs.image ?? ''}`.trim();
			}
			const terminated = cs.state?.terminated;
			if (terminated && terminated.exitCode !== 0) {
				return `${terminated.reason ?? 'Terminated'} (exit ${terminated.exitCode})`;
			}
		}
	}
	return null;
}

export async function deleteIgnoreMissing(fn: () => Promise<unknown>): Promise<void> {
	try {
		await fn();
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
}

// Run a create and swallow a 409 (peer worker / earlier tick already made it) to keep read-then-create safe under concurrency.
export async function createIgnoreConflict(create: () => Promise<unknown>): Promise<void> {
	try {
		await create();
	} catch (err) {
		if (!isConflict(err)) throw err;
	}
}

// Read-modify-replace retry for 409 conflicts; exhausting attempts logs a warning rather than throwing, since the reconcile retries next tick.
export async function retryOnConflict(label: string, attempts: number, attempt: () => Promise<void>): Promise<void> {
	for (let i = 1; i <= attempts; i++) {
		try {
			await attempt();
			return;
		} catch (err) {
			if (!isConflict(err)) throw err;
		}
	}
	console.warn(`[reconcile] ${label} did not converge after ${attempts} conflicting attempts`);
}
