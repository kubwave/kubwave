import type { CoreV1Api, BatchV1Api, V1ConfigMap, V1Secret, V1Job } from '@kubernetes/client-node';

export type BuildCoreApi = Pick<
	CoreV1Api,
	'readNamespacedConfigMap' | 'createNamespacedConfigMap' | 'createNamespacedSecret' | 'deleteNamespacedSecret'
>;
export type BuildBatchApi = Pick<BatchV1Api, 'createNamespacedJob'>;

export class BuildArtifacts {
	readonly secrets = new Map<string, V1Secret>();
	readonly configMaps = new Map<string, V1ConfigMap>();
	job: V1Job | null = null;

	readonly coreApi: BuildCoreApi = {
		readNamespacedConfigMap: async () => {
			throw { code: 404 };
		},
		createNamespacedConfigMap: async ({ body }) => {
			this.configMaps.set(body.metadata!.name!, body);
			return body;
		},
		createNamespacedSecret: async ({ body }) => {
			this.secrets.set(body.metadata!.name!, body);
			return body;
		},
		deleteNamespacedSecret: async ({ name }) => {
			this.secrets.delete(name);
			return {};
		}
	};

	readonly batchApi: BuildBatchApi = {
		createNamespacedJob: async ({ body }) => {
			this.job = body;
			return body;
		}
	};
}
