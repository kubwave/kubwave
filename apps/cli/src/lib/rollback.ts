import { AppsV1Api, type KubeConfig } from '@kubernetes/client-node';
import { APP_NAMESPACE, HELM_RELEASE_NAME } from '~/lib/constants.js';
import { execHelm } from '~/lib/helm.js';
import type { ProgressReporter } from '~/lib/progress.js';
const ROLLOUT_TIMEOUT_MS = 5 * 60 * 1000;

export interface ImageSnapshot {
	[deploymentName: string]: string;
}

export async function captureImageTags(kc: KubeConfig): Promise<ImageSnapshot> {
	const api = kc.makeApiClient(AppsV1Api);
	const snapshot: ImageSnapshot = {};

	const deployments = await api.listNamespacedDeployment({ namespace: APP_NAMESPACE, labelSelector: 'app.kubernetes.io/part-of=kubwave' });
	for (const dep of deployments.items) {
		const name = dep.metadata?.name;
		const image = dep.spec?.template?.spec?.containers?.[0]?.image;
		if (name && image) snapshot[name] = image;
	}

	const statefulSets = await api.listNamespacedStatefulSet({ namespace: APP_NAMESPACE, labelSelector: 'app.kubernetes.io/part-of=kubwave' });
	for (const sts of statefulSets.items) {
		const name = sts.metadata?.name;
		const image = sts.spec?.template?.spec?.containers?.[0]?.image;
		if (name && image) snapshot[name] = image;
	}

	return snapshot;
}

export async function waitForRollout(kc: KubeConfig, reporter: ProgressReporter): Promise<boolean> {
	const api = kc.makeApiClient(AppsV1Api);

	const deployments = await api.listNamespacedDeployment({ namespace: APP_NAMESPACE, labelSelector: 'app.kubernetes.io/part-of=kubwave' });
	const statefulSets = await api.listNamespacedStatefulSet({ namespace: APP_NAMESPACE, labelSelector: 'app.kubernetes.io/part-of=kubwave' });

	const targets = [
		...deployments.items.map(d => ({ kind: 'deployment' as const, name: d.metadata?.name ?? '' })),
		...statefulSets.items.map(s => ({ kind: 'statefulset' as const, name: s.metadata?.name ?? '' }))
	];

	for (const target of targets) {
		reporter.start(`Checking rollout status: ${target.kind}/${target.name}...`);
		const ok = await waitForSingleRollout(api, target.kind, target.name);
		if (!ok) {
			reporter.fail(`Rollout timeout: ${target.kind}/${target.name}`, `Timed out after ${ROLLOUT_TIMEOUT_MS / 1000}s`);
			return false;
		}
		reporter.succeed(`Rollout complete: ${target.kind}/${target.name}`);
	}

	return true;
}

async function waitForSingleRollout(api: AppsV1Api, kind: 'deployment' | 'statefulset', name: string): Promise<boolean> {
	const deadline = Date.now() + ROLLOUT_TIMEOUT_MS;

	while (Date.now() < deadline) {
		const ready = kind === 'deployment' ? await isDeploymentReady(api, name) : await isStatefulSetReady(api, name);

		if (ready) return true;
		await Bun.sleep(3000);
	}

	return false;
}

async function isDeploymentReady(api: AppsV1Api, name: string): Promise<boolean> {
	const dep = await api.readNamespacedDeployment({ name, namespace: APP_NAMESPACE });
	const desired = dep.spec?.replicas ?? 1;
	const ready = dep.status?.readyReplicas ?? 0;
	const updated = dep.status?.updatedReplicas ?? 0;
	return ready >= desired && updated >= desired;
}

async function isStatefulSetReady(api: AppsV1Api, name: string): Promise<boolean> {
	const sts = await api.readNamespacedStatefulSet({ name, namespace: APP_NAMESPACE });
	const desired = sts.spec?.replicas ?? 1;
	const ready = sts.status?.readyReplicas ?? 0;
	const updated = sts.status?.updatedReplicas ?? 0;
	return ready >= desired && updated >= desired;
}

export async function helmRollback(reporter: ProgressReporter): Promise<boolean> {
	reporter.start('Helm rollback...');
	const { exitCode, stderr } = await execHelm(['rollback', HELM_RELEASE_NAME, '--namespace', APP_NAMESPACE, '--wait', '--timeout', '5m']);
	if (exitCode !== 0) {
		reporter.fail('Helm rollback failed', stderr);
		return false;
	}
	reporter.succeed('Helm rollback successful');
	return true;
}
