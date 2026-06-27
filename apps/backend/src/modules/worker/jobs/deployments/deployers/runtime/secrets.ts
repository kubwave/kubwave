import { createHash } from 'node:crypto';
import type { CoreV1Api, V1Secret } from '@kubernetes/client-node';
import type { DeploymentLogEntry, RuntimeConfig } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { secretName } from '@kubwave/kube';
import { convergeManagedSecret } from '../../../../../../shared/cluster/ops.js';
import { commonLabels, stepEvent } from '../../../../../../shared/cluster/networking.js';

export function secretList(config: RuntimeConfig): Array<{ key: string; value: string }> {
	return config.secrets ?? [];
}

// Hash over the sorted encrypted entries (uses ciphertext from config, no decryption to detect a change); null when no secrets so the annotation is omitted.
export function secretsChecksum(config: RuntimeConfig): string | null {
	const secrets = secretList(config);
	if (secrets.length === 0) return null;
	const joined = secrets
		.map(s => `${s.key}=${s.value}`)
		.sort()
		.join('\n');
	return createHash('sha256').update(joined).digest('hex');
}

// The K8s Secret holding decrypted env vars (worker holds SECRETS_KEY); the container consumes them via secretKeyRef.
export function buildSecret(serviceId: string, namespace: string, config: RuntimeConfig): V1Secret {
	const stringData: Record<string, string> = {};
	for (const s of secretList(config)) stringData[s.key] = decryptSecret(s.value);
	return {
		apiVersion: 'v1',
		kind: 'Secret',
		metadata: { name: secretName(serviceId), namespace, labels: commonLabels(serviceId) },
		type: 'Opaque',
		stringData
	};
}

// True when the live Secret's decoded data equals the desired plaintext; the API returns base64 `data` so decode before comparing.
export function secretMatches(existing: V1Secret, desired: V1Secret): boolean {
	const existingData = existing.data ?? {};
	const desiredData = desired.stringData ?? {};
	const eKeys = Object.keys(existingData).sort();
	const dKeys = Object.keys(desiredData).sort();
	if (eKeys.length !== dKeys.length || !eKeys.every((k, i) => k === dKeys[i])) return false;
	return dKeys.every(k => Buffer.from(existingData[k] ?? '', 'base64').toString('utf8') === desiredData[k]);
}

// Converge the env Secret (create/replace/delete by presence); idempotent, emits a step event only on write. Run before the Deployment so a first create can reference it.
export async function convergeSecret(
	api: CoreV1Api,
	namespace: string,
	serviceId: string,
	config: RuntimeConfig,
	events: DeploymentLogEntry[]
): Promise<void> {
	const name = secretName(serviceId);
	const count = secretList(config).length;
	await convergeManagedSecret(api, namespace, name, {
		isEmpty: count === 0,
		build: () => buildSecret(serviceId, namespace, config),
		matches: secretMatches,
		events,
		event: action =>
			action === 'removed'
				? stepEvent('secret-converged', `Removed Secret ${name} in ${namespace} (no secrets configured)`)
				: stepEvent('secret-converged', `${action === 'created' ? 'Created' : 'Updated'} Secret ${name} in ${namespace} (${count} key(s))`)
	});
}
