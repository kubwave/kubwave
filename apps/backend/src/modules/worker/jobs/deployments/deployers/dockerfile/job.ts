import type { V1Job } from '@kubernetes/client-node';
import { buildKitArgs, buildKitContainer, buildKitVolumes } from '../../builds/buildkit.js';
import {
	buildImageRef,
	buildJobLabels,
	BUILDER_LABEL_SELECTOR,
	COMPONENT_BUILDER,
	LABEL_COMPONENT,
	LABEL_DEPLOYMENT_ID
} from '../../builds/service.js';

// Build labels + image-ref scheme are shared by every build type - re-exported so existing importers keep one entry point.
export { buildImageRef, buildJobLabels, BUILDER_LABEL_SELECTOR, COMPONENT_BUILDER, LABEL_COMPONENT, LABEL_DEPLOYMENT_ID };

const BUILD_WORKSPACE = '/workspace';

// Deterministic names so the deployer converges by name without extra state; a create race just yields a tolerated 409.
export function buildJobName(deploymentId: string): string {
	return `dockerfile-build-${deploymentId}`;
}

export function buildConfigMapName(deploymentId: string): string {
	return `dockerfile-build-${deploymentId}`;
}

export interface DockerfileBuildJobOptions {
	deploymentId: string;
	serviceId: string;
	imageRef: string;
	configMapName: string;
	builderImage: string;
	cacheRef?: string;
	// Plain-HTTP registry (dev k3d) -> tell BuildKit to push/cache against an insecure registry.
	insecure: boolean;
	serviceAccount: string;
	ttlSeconds: number;
	timeoutSeconds: number;
	// Build container memory - bounds the build so it can't get evicted on a small node.
	memoryRequest: string;
	memoryLimit: string;
	// dockerconfigjson Secret mounted as DOCKER_CONFIG for an authenticated push (prod); undefined in dev (anonymous registry).
	pushConfigSecretName?: string;
}

// BuildKit Job building the Dockerfile and pushing to the registry; context is JUST the Dockerfile (from a ConfigMap), so it must be self-contained.
export function buildDockerfileBuildJob(opts: DockerfileBuildJobOptions): V1Job {
	const labels = buildJobLabels(opts.serviceId, opts.deploymentId);
	const args = buildKitArgs({
		imageRef: opts.imageRef,
		contextDir: BUILD_WORKSPACE,
		dockerfileDir: BUILD_WORKSPACE,
		dockerfilePath: 'Dockerfile',
		cacheRef: opts.cacheRef,
		insecure: opts.insecure
	});

	return {
		apiVersion: 'batch/v1',
		kind: 'Job',
		metadata: { name: buildJobName(opts.deploymentId), labels },
		spec: {
			backoffLimit: 0,
			ttlSecondsAfterFinished: opts.ttlSeconds,
			activeDeadlineSeconds: opts.timeoutSeconds,
			template: {
				metadata: { labels },
				spec: {
					restartPolicy: 'Never',
					serviceAccountName: opts.serviceAccount,
					automountServiceAccountToken: false,
					securityContext: { fsGroup: 1000 },
					containers: [
						buildKitContainer({
							image: opts.builderImage,
							args,
							imageRef: opts.imageRef,
							insecure: opts.insecure,
							memoryRequest: opts.memoryRequest,
							memoryLimit: opts.memoryLimit,
							volumeMounts: [{ name: 'workspace', mountPath: BUILD_WORKSPACE }]
						})
					],
					volumes: [
						{ name: 'workspace', configMap: { name: opts.configMapName, items: [{ key: 'Dockerfile', path: 'Dockerfile' }] } },
						...buildKitVolumes(opts.pushConfigSecretName)
					]
				}
			}
		}
	};
}
