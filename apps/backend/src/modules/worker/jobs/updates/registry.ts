import * as k8s from '@kubernetes/client-node';
import { isNotFound, PLATFORM_CONFIGMAP_NAME } from '@kubwave/kube';

export async function resolveUpdateImageRegistry(kc: k8s.KubeConfig, coreApi: k8s.CoreV1Api, namespace: string): Promise<string> {
	const markerRegistry = await readMarkerImageRegistry(coreApi, namespace);
	if (markerRegistry) return markerRegistry;

	const appsApi = kc.makeApiClient(k8s.AppsV1Api);
	for (const workload of ['worker', 'api', 'console'] as const) {
		try {
			const dep = await appsApi.readNamespacedDeployment({ name: workload, namespace });
			const image =
				dep.spec?.template?.spec?.containers?.find(container => container.name === workload)?.image ??
				dep.spec?.template?.spec?.containers?.[0]?.image;
			const registry = imageRegistryFromImage(image, workload);
			if (registry) return registry;
		} catch (err) {
			if (!isNotFound(err)) throw err;
		}
	}

	throw new Error('Could not determine update image registry from platform marker or live workload images');
}

async function readMarkerImageRegistry(coreApi: k8s.CoreV1Api, namespace: string): Promise<string | null> {
	try {
		const cm = await coreApi.readNamespacedConfigMap({ name: PLATFORM_CONFIGMAP_NAME, namespace });
		return cm.data?.['image_registry'] || null;
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

export function imageRegistryFromImage(image: string | undefined, workload: string): string | null {
	if (!image) return null;
	const slash = image.lastIndexOf('/');
	const colon = image.lastIndexOf(':');
	const repository = colon > slash ? image.slice(0, colon) : image;
	const suffix = `/${workload}`;
	if (repository.endsWith(suffix)) return repository.slice(0, -suffix.length);
	const lastSlash = repository.lastIndexOf('/');
	return lastSlash > 0 ? repository.slice(0, lastSlash) : null;
}
