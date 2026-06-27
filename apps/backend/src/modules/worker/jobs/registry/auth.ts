import { CoreV1Api } from '@kubernetes/client-node';
import { getKubeConfig } from '@kubwave/kube';
import { readSecretOrNull } from '../../../../shared/cluster/ops.js';
import { env } from '../../../../shared/config/worker-env.js';

export function basicAuthFromDockerConfig(encodedDockerConfigJson: string): string | null {
	try {
		const decoded = Buffer.from(encodedDockerConfigJson, 'base64').toString('utf-8');
		const config = JSON.parse(decoded) as { auths?: Record<string, { auth?: string; username?: string; password?: string }> };
		const entries = Object.values(config.auths ?? {});
		for (const entry of entries) {
			if (entry.auth) return entry.auth;
			if (entry.username && entry.password) {
				return Buffer.from(`${entry.username}:${entry.password}`).toString('base64');
			}
		}
		return null;
	} catch {
		return null;
	}
}

export async function registryAuthHeaders(): Promise<Record<string, string>> {
	if (!env.registryPushSecretName) {
		return {};
	}
	const api = getKubeConfig().makeApiClient(CoreV1Api);
	const secret = await readSecretOrNull(api, env.podNamespace, env.registryPushSecretName);
	const encoded = secret?.data?.['.dockerconfigjson'];
	if (!encoded) {
		return {};
	}
	const basic = basicAuthFromDockerConfig(encoded);
	return basic ? { Authorization: `Basic ${basic}` } : {};
}

export function resetRegistryAuthCache(): void {
	// Kept as a no-op for tests and callers from older builds; auth is read fresh on every call.
}
