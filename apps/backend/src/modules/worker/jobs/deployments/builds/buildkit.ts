import type { V1Container, V1ResourceRequirements, V1Volume, V1VolumeMount } from '@kubernetes/client-node';

export const BUILDER_CONTAINER = 'builder';
export const BUILDKIT_CACHE_TAG = 'buildcache';

const DOCKER_CONFIG_DIR = '/home/user/.docker';
const BUILDKIT_STATE_DIR = '/home/user/.local/share/buildkit';
const BUILDKIT_CONFIG_DIR = '/home/user/.config/buildkit';
const BUILDKIT_CONFIG_PATH = `${BUILDKIT_CONFIG_DIR}/buildkitd.toml`;

const BUILDKIT_ENTRYPOINT = `set -e
if [ -n "$BUILDKIT_REGISTRY_HOST" ]; then
  cat > "${BUILDKIT_CONFIG_PATH}" <<EOF
[registry."$BUILDKIT_REGISTRY_HOST"]
  http = true
  insecure = true
EOF
fi
exec buildctl-daemonless.sh "$@"`;

// Request prevents scheduler over-pack; limit turns a runaway build into a clean in-container OOMKill.
export function builderResources(requestMemory: string, limitMemory: string): V1ResourceRequirements {
	return { requests: { memory: requestMemory }, limits: { memory: limitMemory } };
}

export function buildCacheRef(registryEndpoint: string, environmentId: string, serviceId: string): string {
	return `${registryEndpoint}/env-${environmentId}/svc-${serviceId}:${BUILDKIT_CACHE_TAG}`;
}

function registryHostFromImageRef(imageRef: string): string {
	const slash = imageRef.indexOf('/');
	return slash > 0 ? imageRef.slice(0, slash) : imageRef;
}

export function buildKitArgs(opts: {
	imageRef: string;
	contextDir: string;
	dockerfileDir: string;
	dockerfilePath: string;
	cacheRef?: string;
	insecure: boolean;
	buildArgs?: Array<{ key: string; value: string }>;
}): string[] {
	const output = ['type=image', `name=${opts.imageRef}`, 'push=true', ...(opts.insecure ? ['registry.insecure=true'] : [])].join(',');
	const args = [
		'build',
		'--frontend',
		'dockerfile.v0',
		'--local',
		`context=${opts.contextDir}`,
		'--local',
		`dockerfile=${opts.dockerfileDir}`,
		'--opt',
		`filename=${opts.dockerfilePath}`,
		'--output',
		output,
		...(opts.cacheRef
			? ['--import-cache', `type=registry,ref=${opts.cacheRef}`, '--export-cache', `type=registry,ref=${opts.cacheRef},mode=max`]
			: []),
		...(opts.buildArgs ?? []).flatMap(e => ['--opt', `build-arg:${e.key}=${e.value}`])
	];

	return args;
}

export function buildKitContainer(opts: {
	image: string;
	args: string[];
	imageRef: string;
	insecure: boolean;
	memoryRequest: string;
	memoryLimit: string;
	volumeMounts: V1VolumeMount[];
}): V1Container {
	return {
		name: BUILDER_CONTAINER,
		image: opts.image,
		command: ['sh', '-ec', BUILDKIT_ENTRYPOINT, 'buildctl-daemonless.sh'],
		args: opts.args,
		env: [
			{
				name: 'BUILDKITD_FLAGS',
				value: opts.insecure ? `--oci-worker-no-process-sandbox --config=${BUILDKIT_CONFIG_PATH}` : '--oci-worker-no-process-sandbox'
			},
			{ name: 'BUILDKIT_CONFIG_PATH', value: BUILDKIT_CONFIG_PATH },
			{ name: 'DOCKER_CONFIG', value: DOCKER_CONFIG_DIR },
			...(opts.insecure ? [{ name: 'BUILDKIT_REGISTRY_HOST', value: registryHostFromImageRef(opts.imageRef) }] : [])
		],
		resources: builderResources(opts.memoryRequest, opts.memoryLimit),
		securityContext: {
			runAsUser: 1000,
			runAsGroup: 1000,
			appArmorProfile: { type: 'Unconfined' },
			seccompProfile: { type: 'Unconfined' }
		},
		volumeMounts: [
			...opts.volumeMounts,
			{ name: 'docker-config', mountPath: DOCKER_CONFIG_DIR },
			{ name: 'buildkit-state', mountPath: BUILDKIT_STATE_DIR },
			{ name: 'buildkit-config', mountPath: BUILDKIT_CONFIG_DIR }
		]
	};
}

export function buildKitVolumes(pushConfigSecretName?: string): V1Volume[] {
	return [
		pushConfigSecretName
			? {
					name: 'docker-config',
					secret: { secretName: pushConfigSecretName, items: [{ key: '.dockerconfigjson', path: 'config.json' }] }
				}
			: { name: 'docker-config', emptyDir: {} },
		{ name: 'buildkit-state', emptyDir: {} },
		{ name: 'buildkit-config', emptyDir: {} }
	];
}
