import { createHash } from 'node:crypto';
import type { CoreV1Api, V1Secret } from '@kubernetes/client-node';
import type { DeploymentLogEntry, RuntimeConfig, ServiceConfigFile } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { fileKey, resourceName } from '@kubwave/kube';
import { convergeManagedSecret } from '../../../../../../shared/cluster/ops.js';
import { commonLabels, stepEvent } from '../../../../../../shared/cluster/networking.js';
import { secretMatches } from './secrets.js';

export function filesList(config: RuntimeConfig): ServiceConfigFile[] {
	return config.configFiles ?? [];
}

// Dedicated Secret holding rendered config files; they carry credentials (e.g. kong.yml's service_role key), so they ride the same encrypt/decrypt path.
export function filesSecretName(serviceId: string): string {
	return `${resourceName(serviceId)}-files`;
}

// Hash over sorted path=ciphertext entries (no decryption); null when no files so the annotation is omitted.
export function filesChecksum(config: RuntimeConfig): string | null {
	const files = filesList(config);
	if (files.length === 0) return null;
	const joined = files
		.map(f => `${f.path}=${f.content}`)
		.sort()
		.join('\n');
	return createHash('sha256').update(joined).digest('hex');
}

// The K8s Secret projecting decrypted file content (worker holds SECRETS_KEY); mounted via subPath.
export function buildFilesSecret(serviceId: string, namespace: string, config: RuntimeConfig): V1Secret {
	const stringData: Record<string, string> = {};
	for (const f of filesList(config)) stringData[fileKey(f.path)] = decryptSecret(f.content);
	return {
		apiVersion: 'v1',
		kind: 'Secret',
		metadata: { name: filesSecretName(serviceId), namespace, labels: commonLabels(serviceId) },
		type: 'Opaque',
		stringData
	};
}

// Converge the files Secret (create/replace/delete by presence); idempotent, emits a step event only on write. Run before the Deployment so a first create is visible.
export async function convergeConfigFiles(
	api: CoreV1Api,
	namespace: string,
	serviceId: string,
	config: RuntimeConfig,
	events: DeploymentLogEntry[]
): Promise<void> {
	const name = filesSecretName(serviceId);
	const count = filesList(config).length;
	await convergeManagedSecret(api, namespace, name, {
		isEmpty: count === 0,
		build: () => buildFilesSecret(serviceId, namespace, config),
		matches: secretMatches,
		events,
		event: action =>
			action === 'removed'
				? stepEvent('config-files-converged', `Removed Secret ${name} in ${namespace} (no config files)`)
				: stepEvent('config-files-converged', `${action === 'created' ? 'Created' : 'Updated'} Secret ${name} in ${namespace} (${count} file(s))`)
	});
}
