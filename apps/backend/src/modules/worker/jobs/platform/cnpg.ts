// CloudNativePG coordinates, shared by the HA reconciler and volume autoscaler; cluster name mirrors templates/postgres/cluster.yaml.
export const CNPG_GROUP = 'postgresql.cnpg.io';
export const CNPG_VERSION = 'v1';
export const CNPG_PLURAL = 'clusters';
// Cluster name is shared with the platform-volume usage read (api) -> single source in kube.
export { CNPG_CLUSTER_NAME } from '@kubwave/kube';

// Minimal view of the CNPG Cluster CR; Record<string, unknown> preserves operator/chart-set fields on read-modify-replace.
export type CnpgCluster = {
	metadata?: { annotations?: Record<string, string> } & Record<string, unknown>;
	spec?: {
		instances?: number;
		affinity?: { enablePodAntiAffinity?: boolean; topologyKey?: string; podAntiAffinityType?: string } & Record<string, unknown>;
		storage?: { size?: string; storageClass?: string } & Record<string, unknown>;
	} & Record<string, unknown>;
} & Record<string, unknown>;
