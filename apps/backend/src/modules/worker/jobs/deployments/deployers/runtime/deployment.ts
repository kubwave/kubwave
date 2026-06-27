import type { V1Deployment, V1EnvVar, V1PodSecurityContext, V1SecurityContext } from '@kubernetes/client-node';
import type { Deployment, RuntimeConfig, ServiceDomain } from '@kubwave/db';
import { fileKey, pvcName, resourceName, secretName, selectorLabels, SERVICE_ROLLOUT_PROGRESS_DEADLINE_SECONDS } from '@kubwave/kube';
import { commonLabels } from '../../../../../../shared/cluster/networking.js';
import { autoscalingEnabled } from './autoscaling.js';
import { buildProbes, probesMatch } from './probes.js';
import { buildResources, resourcesMatch } from './resources.js';
import { secretList, secretsChecksum } from './secrets.js';
import { filesChecksum, filesList, filesSecretName } from './config-files.js';
import { hasVolume } from './storage.js';
import {
	ANNOTATION_CONFIG_FILES_CHECKSUM,
	ANNOTATION_SECRETS_CHECKSUM,
	CONFIG_FILES_VOLUME_NAME,
	CONTAINER_NAME,
	PSS_RESTRICTED,
	TENANT_ADD_CAPABILITIES,
	TENANT_DROP_CAPABILITIES,
	TENANT_SECCOMP_PROFILE_TYPE
} from './runtime.types.js';

// Container hardening. allowPrivilegeEscalation:false is safe everywhere (sets no_new_privs; doesn't block a root->non-root drop).
// Capability drop is gated on `restricted`: dropping ALL strips SETUID/SETGID/CHOWN and breaks root-then-drop images, so baseline keeps runtime-default caps.
function tenantContainerSecurityContext(podSecurityEnforce?: string): V1SecurityContext {
	return {
		allowPrivilegeEscalation: false,
		...(podSecurityEnforce === PSS_RESTRICTED ? { capabilities: { drop: [...TENANT_DROP_CAPABILITIES], add: [...TENANT_ADD_CAPABILITIES] } } : {})
	};
}

// Pod securityContext: always the seccomp sandbox; under `restricted` also pin runAsNonRoot so kubwave's own pods pass admission (root images then fail by design).
function tenantPodSecurityContext(podSecurityEnforce?: string): V1PodSecurityContext {
	return {
		seccompProfile: { type: TENANT_SECCOMP_PROFILE_TYPE },
		...(podSecurityEnforce === PSS_RESTRICTED ? { runAsNonRoot: true } : {})
	};
}

export function buildEnv(deployment: Deployment, config: RuntimeConfig): V1EnvVar[] {
	const plain: V1EnvVar[] = config.env.map(e => ({ name: e.key, value: e.value }));
	const secrets: V1EnvVar[] = secretList(config).map(s => ({
		name: s.key,
		valueFrom: { secretKeyRef: { name: secretName(deployment.serviceId), key: s.key } }
	}));
	return [...plain, ...secrets];
}

export function buildDeployment(
	deployment: Deployment,
	namespace: string,
	config: RuntimeConfig,
	imageRef: string,
	opts?: { imagePullSecretName?: string; podSecurityEnforce?: string; runtimeClass?: string }
): V1Deployment {
	const name = resourceName(deployment.serviceId);
	const labels = commonLabels(deployment.serviceId);
	const probes = config.healthCheck ? buildProbes(config.healthCheck, config.containerPort) : null;
	const resources = buildResources(config.resources);
	const hpaManaged = autoscalingEnabled(config);
	const envEntries = buildEnv(deployment, config);
	const checksum = secretsChecksum(config);
	const filesCk = filesChecksum(config);
	const files = filesList(config);
	const annotations: Record<string, string> = {
		...(checksum ? { [ANNOTATION_SECRETS_CHECKSUM]: checksum } : {}),
		...(filesCk ? { [ANNOTATION_CONFIG_FILES_CHECKSUM]: filesCk } : {})
	};
	// Volumes mount whole dirs; config files mount one file each via subPath. A volume's own subPath mounts a PVC subdir (e.g. so initdb sees an empty dir, not lost+found).
	const volumeMounts = [
		...config.volumes.map(v => ({ name: v.name, mountPath: v.mountPath, ...(v.subPath ? { subPath: v.subPath } : {}) })),
		...files.map(f => ({ name: CONFIG_FILES_VOLUME_NAME, mountPath: f.path, subPath: fileKey(f.path), readOnly: true }))
	];
	const podVolumes = [
		...config.volumes.map(v => ({ name: v.name, persistentVolumeClaim: { claimName: pvcName(deployment.serviceId, v.name) } })),
		...(files.length > 0 ? [{ name: CONFIG_FILES_VOLUME_NAME, secret: { secretName: filesSecretName(deployment.serviceId) } }] : [])
	];
	return {
		apiVersion: 'apps/v1',
		kind: 'Deployment',
		metadata: { name, namespace, labels },
		spec: {
			// Leave replicas unset when an HPA manages them so we don't reset its scaling.
			...(hpaManaged ? {} : { replicas: 1 }),
			// Volume-backed services use Recreate: RollingUpdate would need the single RWO PVC on two nodes (Multi-Attach) and stall.
			...(hasVolume(config) ? { strategy: { type: 'Recreate' } } : {}),
			progressDeadlineSeconds: SERVICE_ROLLOUT_PROGRESS_DEADLINE_SECONDS,
			selector: { matchLabels: selectorLabels(deployment.serviceId) },
			template: {
				metadata: {
					labels,
					// Roll the pods when a secret value or a config-file's content changes (neither restarts pods on its own).
					...(Object.keys(annotations).length > 0 ? { annotations } : {})
				},
				spec: {
					securityContext: tenantPodSecurityContext(opts?.podSecurityEnforce),
					...(opts?.runtimeClass ? { runtimeClassName: opts.runtimeClass } : {}),
					// Only when the platform registry needs auth (prod); dev's registry is anonymous, so pods pull without a secret.
					...(opts?.imagePullSecretName ? { imagePullSecrets: [{ name: opts.imagePullSecretName }] } : {}),
					containers: [
						{
							name: CONTAINER_NAME,
							image: imageRef,
							securityContext: tenantContainerSecurityContext(opts?.podSecurityEnforce),
							...(config.containerPort != null ? { ports: [{ containerPort: config.containerPort }] } : {}),
							...(config.command && config.command.length > 0 ? { command: config.command } : {}),
							...(config.args && config.args.length > 0 ? { args: config.args } : {}),
							...(envEntries.length > 0 ? { env: envEntries } : {}),
							...(volumeMounts.length > 0 ? { volumeMounts } : {}),
							...(probes ? { livenessProbe: probes.livenessProbe, readinessProbe: probes.readinessProbe } : {}),
							...(resources ? { resources } : {})
						}
					],
					...(podVolumes.length > 0 ? { volumes: podVolumes } : {})
				}
			}
		}
	};
}

export function deploymentMatchesConfig(
	existing: V1Deployment,
	config: RuntimeConfig,
	imageRef: string,
	serviceId: string,
	podSecurityEnforce?: string,
	runtimeClass?: string
): boolean {
	const container = existing.spec?.template?.spec?.containers?.find(c => c.name === CONTAINER_NAME);
	if (!container) return false;
	if (container.image !== imageRef) return false;
	// When an HPA owns replicas, accept whatever it set; otherwise pin to 1.
	if (!autoscalingEnabled(config) && (existing.spec?.replicas ?? 1) !== 1) return false;
	// Volume-backed -> Recreate, else RollingUpdate; the API reports an explicit type, so compare against the default we omit on write.
	const desiredStrategy = hasVolume(config) ? 'Recreate' : 'RollingUpdate';
	if ((existing.spec?.strategy?.type ?? 'RollingUpdate') !== desiredStrategy) return false;
	if ((existing.spec?.progressDeadlineSeconds ?? null) !== SERVICE_ROLLOUT_PROGRESS_DEADLINE_SECONDS) return false;
	// Pod-level seccomp profile - a pre-hardening Deployment has none, so this rolls it once.
	if ((existing.spec?.template?.spec?.securityContext?.seccompProfile?.type ?? null) !== TENANT_SECCOMP_PROFILE_TYPE) return false;
	// RuntimeClass: a pre-isolation Deployment has none; a level switch rolls it once. Empty <-> undefined.
	if ((existing.spec?.template?.spec?.runtimeClassName ?? '') !== (runtimeClass ?? '')) return false;
	if ((container.ports?.[0]?.containerPort ?? null) !== (config.containerPort ?? null)) return false;
	if (!probesMatch(container, config)) return false;
	if (!resourcesMatch(container, config)) return false;

	// command/args are part of the container spec; a change must roll the Deployment. Empty <-> undefined.
	const stringArraysEqual = (a: string[] | undefined, b: string[] | undefined): boolean => {
		const x = a ?? [];
		const y = b ?? [];
		return x.length === y.length && x.every((v, i) => v === y[i]);
	};
	if (!stringArraysEqual(container.command, config.command)) return false;
	if (!stringArraysEqual(container.args, config.args)) return false;

	// Pod/container hardening: derive desired values from the same builders buildDeployment uses so build and match can't drift; a pre-hardening Deployment mismatches and rolls once.
	const desiredRunAsNonRoot = tenantPodSecurityContext(podSecurityEnforce).runAsNonRoot ?? null;
	if ((existing.spec?.template?.spec?.securityContext?.runAsNonRoot ?? null) !== desiredRunAsNonRoot) return false;
	const desiredContainerSc = tenantContainerSecurityContext(podSecurityEnforce);
	const containerSc = container.securityContext;
	if (containerSc?.allowPrivilegeEscalation !== desiredContainerSc.allowPrivilegeEscalation) return false;
	if (!stringArraysEqual(containerSc?.capabilities?.drop, desiredContainerSc.capabilities?.drop)) return false;
	if (!stringArraysEqual(containerSc?.capabilities?.add, desiredContainerSc.capabilities?.add)) return false;

	// A secret value change is invisible in the env (secretKeyRef, not a value), so compare the checksum annotation. Absent <-> null.
	const existingChecksum = existing.spec?.template?.metadata?.annotations?.[ANNOTATION_SECRETS_CHECKSUM] ?? null;
	if (existingChecksum !== secretsChecksum(config)) return false;

	// Config-file content lives in a subPath-mounted Secret (no in-place update), so a change must flip this hash too.
	const existingFilesChecksum = existing.spec?.template?.metadata?.annotations?.[ANNOTATION_CONFIG_FILES_CHECKSUM] ?? null;
	if (existingFilesChecksum !== filesChecksum(config)) return false;

	// Env entries: plaintext as `name=value`, secret refs as `name=#secretRef` (value lives in the Secret, compared above).
	const envEntryKey = (e: V1EnvVar): string => (e.valueFrom?.secretKeyRef ? `${e.name}=#secretRef` : `${e.name}=${e.value ?? ''}`);
	const existingEnv = (container.env ?? []).map(envEntryKey).sort();
	const desiredEnv = [...config.env.map(e => `${e.key}=${e.value}`), ...secretList(config).map(s => `${s.key}=#secretRef`)].sort();
	if (existingEnv.length !== desiredEnv.length) return false;
	if (!existingEnv.every((entry, i) => entry === desiredEnv[i])) return false;

	const existingVolMounts = (container.volumeMounts ?? []).map(v => `${v.name}=${v.mountPath}=${v.subPath ?? ''}`).sort();
	const desiredVolMounts = [
		...config.volumes.map(v => `${v.name}=${v.mountPath}=${v.subPath ?? ''}`),
		...filesList(config).map(f => `${CONFIG_FILES_VOLUME_NAME}=${f.path}=${fileKey(f.path)}`)
	].sort();
	if (existingVolMounts.length !== desiredVolMounts.length) return false;
	if (!existingVolMounts.every((entry, i) => entry === desiredVolMounts[i])) return false;

	const existingPodVols = (existing.spec?.template?.spec?.volumes ?? [])
		.filter(v => v.persistentVolumeClaim)
		.map(v => `${v.name}=${v.persistentVolumeClaim!.claimName}`)
		.sort();
	const desiredPodVols = config.volumes.map(v => `${v.name}=${pvcName(serviceId, v.name)}`).sort();
	if (existingPodVols.length !== desiredPodVols.length) return false;
	if (!existingPodVols.every((entry, i) => entry === desiredPodVols[i])) return false;

	return true;
}

// Container ports this workload exposes; domain ports are appended separately by convergeNetworking.
export function containerPorts(config: RuntimeConfig): number[] {
	return config.containerPort != null ? [config.containerPort] : [];
}

// The auto-generated default host is an opt-in fallback: applies only when enabled and the service has no custom domains.
export function withDefaultDomain(config: RuntimeConfig, defaultDomainHost: string | null): ServiceDomain[] {
	if (config.domains.length > 0) return config.domains;
	if (config.defaultDomainEnabled !== true) return config.domains;
	if (!defaultDomainHost || config.containerPort == null) return config.domains;
	return [{ host: defaultDomainHost, port: config.containerPort }];
}
