import type { CoreV1Api, V1Secret } from '@kubernetes/client-node';
import type { DeploymentLogEntry } from '@kubwave/db';
import { convergeManagedSecret, readSecretOrNull } from '../../../../../../shared/cluster/ops.js';
import { stepEvent } from '../../../../../../shared/cluster/networking.js';
import { env } from '../../../../../../shared/config/worker-env.js';

// Sync the platform push creds (dockerconfigjson) as a pull Secret into the env namespace; no-op for an anonymous registry.
export async function convergePullSecret(api: CoreV1Api, namespace: string, events: DeploymentLogEntry[]): Promise<void> {
	const targetName = env.registryPullSecretName;
	const sourceName = env.registryPushSecretName;
	if (!targetName || !sourceName) return;

	const source = await readSecretOrNull(api, env.podNamespace, sourceName);
	const dockerConfig = source?.data?.['.dockerconfigjson'];
	if (!dockerConfig) return; // registry creds not present in the platform namespace yet

	await convergeManagedSecret(api, namespace, targetName, {
		isEmpty: false, // creds are present (guarded above); the pull Secret is never deleted here
		build: () => buildPullSecret(namespace, targetName, dockerConfig),
		matches: pullSecretMatches,
		events,
		event: action =>
			stepEvent(
				'pull-secret-converged',
				`${action === 'created' ? 'Provisioned' : 'Updated'} registry pull Secret ${targetName} in ${namespace} from ${env.podNamespace}/${sourceName}`
			)
	});
}

function buildPullSecret(namespace: string, name: string, dockerConfig: string): V1Secret {
	return {
		apiVersion: 'v1',
		kind: 'Secret',
		metadata: { name, namespace },
		type: 'kubernetes.io/dockerconfigjson',
		data: { '.dockerconfigjson': dockerConfig }
	};
}

function pullSecretMatches(existing: V1Secret, desired: V1Secret): boolean {
	return existing.type === desired.type && existing.data?.['.dockerconfigjson'] === desired.data?.['.dockerconfigjson'];
}
