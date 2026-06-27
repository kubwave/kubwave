import * as k8s from '@kubernetes/client-node';

export function getKubeConfig(): k8s.KubeConfig {
	const kc = new k8s.KubeConfig();
	if (process.env.KUBERNETES_SERVICE_HOST) {
		kc.loadFromCluster();
	} else {
		kc.loadFromDefault();
	}
	return kc;
}
