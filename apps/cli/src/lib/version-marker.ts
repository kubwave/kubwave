import { CoreV1Api, type KubeConfig } from '@kubernetes/client-node';
import { APP_LABELS, APP_NAMESPACE, PLATFORM_CONFIGMAP_NAME } from '~/lib/constants.js';
import { isChannel, type Channel } from '~/lib/channel.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';
import { decodeInstallStateData, encodeInstallStateData, type PartialInstallState } from '~/lib/install-state.js';

export interface VersionMarker {
	currentVersion: string;
	installedAt: string;
	installedBy: string;
	channel: Channel;
	installState?: PartialInstallState;
}

export async function readVersionMarker(kc: KubeConfig): Promise<VersionMarker | null> {
	const api = kc.makeApiClient(CoreV1Api);
	try {
		const cm = await api.readNamespacedConfigMap({ name: PLATFORM_CONFIGMAP_NAME, namespace: APP_NAMESPACE });
		const rawChannel = cm.data?.['channel'];
		const installState = decodeInstallStateData(cm.data);
		return {
			currentVersion: cm.data?.['current_version'] ?? 'unknown',
			installedAt: cm.data?.['installed_at'] ?? 'unknown',
			installedBy: cm.data?.['installed_by'] ?? 'unknown',
			channel: isChannel(rawChannel) ? rawChannel : 'stable',
			...(installState ? { installState } : {})
		};
	} catch (err: unknown) {
		if (isNotFoundError(err)) return null;
		throw err;
	}
}

export async function writeVersionMarker(
	kc: KubeConfig,
	version: string,
	installedBy: string = 'cli',
	channel: Channel = 'stable',
	installState?: PartialInstallState
): Promise<void> {
	const api = kc.makeApiClient(CoreV1Api);
	const buildData = (existingData?: Record<string, string>) => ({
		current_version: version,
		installed_at: new Date().toISOString(),
		installed_by: installedBy,
		channel,
		...encodeInstallStateData(installState ?? decodeInstallStateData(existingData))
	});

	try {
		const existing = await api.readNamespacedConfigMap({ name: PLATFORM_CONFIGMAP_NAME, namespace: APP_NAMESPACE });
		await api.replaceNamespacedConfigMap({
			name: PLATFORM_CONFIGMAP_NAME,
			namespace: APP_NAMESPACE,
			body: {
				metadata: {
					name: PLATFORM_CONFIGMAP_NAME,
					namespace: APP_NAMESPACE,
					labels: APP_LABELS
				},
				data: buildData(existing.data)
			}
		});
	} catch (err: unknown) {
		if (isNotFoundError(err)) {
			await api.createNamespacedConfigMap({
				namespace: APP_NAMESPACE,
				body: {
					metadata: {
						name: PLATFORM_CONFIGMAP_NAME,
						namespace: APP_NAMESPACE,
						labels: APP_LABELS
					},
					data: buildData()
				}
			});
		} else {
			throw err;
		}
	}
}
