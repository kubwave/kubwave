import type { CoreV1Api, V1Secret } from '@kubernetes/client-node';
import type { DeploymentLogEntry, RegistryAuthConfig } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { normalizeRegistryServer, registrySecretName } from '@kubwave/kube';
import { convergeManagedSecret, readSecretOrNull } from '../../../../../../shared/cluster/ops.js';
import { commonLabels, stepEvent } from '../../../../../../shared/cluster/networking.js';
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

// Per-service pull Secret for a private image registry; deleted when the service has no credentials configured.
export async function convergeServicePullSecret(
	api: CoreV1Api,
	namespace: string,
	serviceId: string,
	registryAuth: RegistryAuthConfig | undefined,
	events: DeploymentLogEntry[]
): Promise<void> {
	const name = registrySecretName(serviceId);
	await convergeManagedSecret(api, namespace, name, {
		isEmpty: !registryAuth,
		build: () => buildServicePullSecret(namespace, serviceId, name, registryAuth!),
		matches: pullSecretMatches,
		events,
		event: action =>
			action === 'removed'
				? stepEvent('registry-secret-converged', `Removed registry pull Secret ${name} in ${namespace} (no credentials configured)`)
				: stepEvent('registry-secret-converged', `${action === 'created' ? 'Created' : 'Updated'} registry pull Secret ${name} in ${namespace}`)
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

// Render a dockerconfigjson keyed by the canonical registry server (Docker Hub -> index.docker.io, same as `docker login`).
export function buildServicePullSecret(namespace: string, serviceId: string, name: string, registryAuth: RegistryAuthConfig): V1Secret {
	const password = decryptSecret(registryAuth.password);
	const server = normalizeRegistryServer(registryAuth.server);
	const dockerConfig = JSON.stringify({
		auths: { [server]: { username: registryAuth.username, password, auth: Buffer.from(`${registryAuth.username}:${password}`).toString('base64') } }
	});
	return {
		apiVersion: 'v1',
		kind: 'Secret',
		metadata: { name, namespace, labels: commonLabels(serviceId) },
		type: 'kubernetes.io/dockerconfigjson',
		data: { '.dockerconfigjson': Buffer.from(dockerConfig).toString('base64') }
	};
}

function pullSecretMatches(existing: V1Secret, desired: V1Secret): boolean {
	return existing.type === desired.type && existing.data?.['.dockerconfigjson'] === desired.data?.['.dockerconfigjson'];
}
