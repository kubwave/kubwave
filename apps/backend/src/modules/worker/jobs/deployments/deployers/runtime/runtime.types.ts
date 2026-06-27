// Shared constants for the deploy core (reconcileRuntime family), common to the split runtime sub-modules.

export const CONTAINER_NAME = 'app';

// Baseline syscall sandbox on every tenant pod: RuntimeDefault narrows the syscall surface (K8s otherwise schedules Unconfined). Existing services roll once to pick it up.
export const TENANT_SECCOMP_PROFILE_TYPE = 'RuntimeDefault';

// Capabilities for the `restricted` profile ONLY: drop ALL then re-add NET_BIND_SERVICE so privileged-port binds (<1024, e.g. nginx :80) keep working.
// NOT under baseline: dropping ALL strips SETUID/SETGID/CHOWN and breaks root-then-drop images (nginx, postgres).
export const TENANT_DROP_CAPABILITIES: string[] = ['ALL'];
export const TENANT_ADD_CAPABILITIES: string[] = ['NET_BIND_SERVICE'];

// Pod Security Standards `restricted` enforce level; selecting it also pins runAsNonRoot so kubwave's own Deployments pass the namespace admission check.
export const PSS_RESTRICTED = 'restricted';

// Pod-template annotation hashing the encrypted secrets; a change flips the hash to force a rollout (K8s won't restart pods when a secretKeyRef'd Secret changes on its own).
export const ANNOTATION_SECRETS_CHECKSUM = 'kubwave/secrets-checksum';

// Same idea for config files: subPath mounts don't update in place, so a content change must flip this hash to roll the pod.
export const ANNOTATION_CONFIG_FILES_CHECKSUM = 'kubwave/config-files-checksum';

// Pod volume name projecting the files Secret. Prefixed to avoid colliding with user-defined volume names.
export const CONFIG_FILES_VOLUME_NAME = 'kubwave-config-files';
