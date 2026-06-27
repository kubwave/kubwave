import type { V1Job } from '@kubernetes/client-node';
import { BUILDER_CONTAINER, buildKitArgs, buildKitContainer, buildKitVolumes } from '../../builds/buildkit.js';
import { buildJobLabels } from '../../builds/service.js';

// Git-to-image builder Job shared by public/private-repo (modes via `opts.builder`); user input reaches containers only as env/argv, never interpolated into shell.

export const PREPARE_CONTAINER = 'prepare';
export const NIXPACKS_CONTAINER = 'nixpacks';
export { BUILDER_CONTAINER };
const WORKSPACE = '/workspace';
const SRC_DIR = `${WORKSPACE}/src`;
const SSH_KEY_MOUNT = '/ssh-key';
const SSH_DIR = `${WORKSPACE}/.ssh`;
const SSH_KEY_FILE = `${SSH_DIR}/id`;
const KNOWN_HOSTS_FILE = `${SSH_DIR}/known_hosts`;

// Clone + SSH setup: a pinned commit needs full history (shallow can't resolve an arbitrary SHA), so it full-clones then detaches; branch-HEAD stays shallow.
const CLONE_SCRIPT = `set -e
if ! command -v git >/dev/null 2>&1; then
  echo "build tools image is missing required command: git" >&2
  exit 1
fi
rm -rf "${SRC_DIR}"
if [ -f "${SSH_KEY_MOUNT}/id" ]; then
  if ! command -v ssh >/dev/null 2>&1; then
    echo "build tools image is missing required command: ssh (needed for private repositories)" >&2
    exit 1
  fi
  mkdir -p "${SSH_DIR}"
  cp "${SSH_KEY_MOUNT}/id" "${SSH_KEY_FILE}"
  chmod 600 "${SSH_KEY_FILE}"
  export GIT_SSH_COMMAND="ssh -i ${SSH_KEY_FILE} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${KNOWN_HOSTS_FILE}"
fi
if [ -n "$SOURCE_COMMIT" ]; then
  git clone --no-checkout "$SOURCE_REPO_URL" "${SRC_DIR}"
  git -C "${SRC_DIR}" checkout --detach "$SOURCE_COMMIT"
else
  git clone --depth 1 --single-branch --branch "$SOURCE_BRANCH" "$SOURCE_REPO_URL" "${SRC_DIR}"
fi`;

// Deterministic name so the deployer converges without extra state (a race yields a tolerated 409); private-repo passes its own prefix to keep the two types distinct.
export function buildJobName(deploymentId: string, prefix = 'public-repo-build'): string {
	return `${prefix}-${deploymentId}`;
}

// Build containers in run order (for failure-log scraping); dockerfile has no nixpacks step. Keep in lockstep with buildSourceJob.
export function sourceBuildContainers(builder: 'nixpacks' | 'dockerfile'): string[] {
	return builder === 'dockerfile' ? [PREPARE_CONTAINER, BUILDER_CONTAINER] : [PREPARE_CONTAINER, NIXPACKS_CONTAINER, BUILDER_CONTAINER];
}

function nixpacksCliEnv(buildEnv: Array<{ key: string; value: string }>): Array<{ name: string; value: string }> {
	return buildEnv.filter(e => e.key.startsWith('NIXPACKS_')).map(e => ({ name: e.key, value: e.value }));
}

export interface SourceJobOptions {
	deploymentId: string;
	serviceId: string;
	imageRef: string;
	repoUrl: string;
	branch: string;
	commit?: string;
	rootDirectory?: string;
	buildCommand?: string;
	startCommand?: string;
	builder: 'nixpacks' | 'dockerfile';
	dockerfilePath?: string;
	buildEnv: Array<{ key: string; value: string }>;
	buildToolsImage: string;
	builderImage: string;
	imagePullSecrets?: string[];
	cacheRef?: string;
	insecure: boolean;
	serviceAccount: string;
	ttlSeconds: number;
	timeoutSeconds: number;
	memoryRequest: string;
	memoryLimit: string;
	pushConfigSecretName?: string;
	sshKeySecretName?: string;
	jobNamePrefix?: string;
}

export function buildSourceJob(opts: SourceJobOptions): V1Job {
	const labels = buildJobLabels(opts.serviceId, opts.deploymentId);
	const isDockerfile = opts.builder === 'dockerfile';
	// Build root: repo root or a monorepo sub-path. Both Nixpacks working dir and BuildKit context point here.
	const contextDir = opts.rootDirectory ? `${SRC_DIR}/${opts.rootDirectory}` : SRC_DIR;

	const nixpacksArgs = [
		'build',
		'.',
		'--out',
		'.',
		...(opts.buildCommand ? ['--build-cmd', opts.buildCommand] : []),
		...(opts.startCommand ? ['--start-cmd', opts.startCommand] : []),
		...opts.buildEnv.flatMap(e => ['--env', `${e.key}=${e.value}`])
	];
	const nixpacksEnv = nixpacksCliEnv(opts.buildEnv);
	const buildArgs = buildKitArgs({
		imageRef: opts.imageRef,
		contextDir,
		dockerfileDir: contextDir,
		dockerfilePath: isDockerfile ? (opts.dockerfilePath ?? 'Dockerfile') : '.nixpacks/Dockerfile',
		cacheRef: opts.cacheRef,
		insecure: opts.insecure,
		buildArgs: isDockerfile ? opts.buildEnv : []
	});

	const usesPushSecret = Boolean(opts.pushConfigSecretName);
	const usesSshKey = Boolean(opts.sshKeySecretName);
	const workspaceMount = { name: 'workspace', mountPath: WORKSPACE };
	// Deploy key mounted read-only on the prepare container only (the one that clones); nixpacks/builder never see it. Mode 0400.
	const sshKeyMount = { name: 'ssh-key', mountPath: SSH_KEY_MOUNT, readOnly: true };

	return {
		apiVersion: 'batch/v1',
		kind: 'Job',
		metadata: { name: buildJobName(opts.deploymentId, opts.jobNamePrefix), labels },
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
					...(opts.imagePullSecrets?.length ? { imagePullSecrets: opts.imagePullSecrets.map(name => ({ name })) } : {}),
					initContainers: [
						{
							name: PREPARE_CONTAINER,
							image: opts.buildToolsImage,
							command: ['sh', '-ec', CLONE_SCRIPT],
							securityContext: { runAsUser: 0 },
							env: [
								{ name: 'SOURCE_REPO_URL', value: opts.repoUrl },
								{ name: 'SOURCE_BRANCH', value: opts.branch },
								...(opts.commit ? [{ name: 'SOURCE_COMMIT', value: opts.commit }] : [])
							],
							volumeMounts: [workspaceMount, ...(usesSshKey ? [sshKeyMount] : [])]
						},
						// The nixpacks generate step exists only for the nixpacks builder; dockerfile goes clone -> builder.
						...(isDockerfile
							? []
							: [
									{
										name: NIXPACKS_CONTAINER,
										image: opts.buildToolsImage,
										workingDir: contextDir,
										command: ['nixpacks'],
										args: nixpacksArgs,
										...(nixpacksEnv.length > 0 ? { env: nixpacksEnv } : {}),
										volumeMounts: [workspaceMount]
									}
								])
					],
					containers: [
						buildKitContainer({
							image: opts.builderImage,
							args: buildArgs,
							imageRef: opts.imageRef,
							insecure: opts.insecure,
							memoryRequest: opts.memoryRequest,
							memoryLimit: opts.memoryLimit,
							volumeMounts: [workspaceMount]
						})
					],
					volumes: [
						{ name: 'workspace', emptyDir: {} },
						...buildKitVolumes(usesPushSecret ? opts.pushConfigSecretName : undefined),
						...(usesSshKey
							? [
									{
										name: 'ssh-key',
										secret: { secretName: opts.sshKeySecretName, items: [{ key: 'id', path: 'id' }], defaultMode: 0o400 }
									}
								]
							: [])
					]
				}
			}
		}
	};
}
