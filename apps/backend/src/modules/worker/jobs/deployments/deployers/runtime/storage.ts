import type { V1PersistentVolumeClaim } from '@kubernetes/client-node';
import type { RuntimeConfig, ServiceVolume } from '@kubwave/db';
import { pvcName } from '@kubwave/kube';
import { commonLabels } from '../../../../../../shared/cluster/networking.js';
import { env } from '../../../../../../shared/config/worker-env.js';

export function buildPVC(serviceId: string, namespace: string, volume: ServiceVolume): V1PersistentVolumeClaim {
	const storageClass = env.storageClassName || undefined;
	return {
		apiVersion: 'v1',
		kind: 'PersistentVolumeClaim',
		metadata: { name: pvcName(serviceId, volume.name), namespace, labels: commonLabels(serviceId) },
		spec: {
			accessModes: ['ReadWriteOnce'],
			...(storageClass ? { storageClassName: storageClass } : {}),
			resources: { requests: { storage: volume.size } }
		}
	};
}

// True when the service carries persistent storage. An RWO PVC attaches to one node at a time, pinning the service to a single
// instance - gates the autoscaling guard and the Recreate rollout strategy (RollingUpdate would need the volume on two nodes).
export function hasVolume(config: RuntimeConfig): boolean {
	return config.volumes.length > 0;
}
