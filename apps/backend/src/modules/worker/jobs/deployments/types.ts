import type { DeploymentStatus } from '@kubwave/db';

// Statuses where a build/image may still be in flight or pushed (build-job reaping, registry prune, registry-GC gating).
// Includes 'pending' on purpose: a queued deployment can acquire a build before it is claimed.
export const BUILD_ACTIVE_STATUSES: readonly DeploymentStatus[] = ['pending', 'deploying', 'canceling'];

// Statuses a worker actively reconciles after claiming; excludes 'pending' (those are claimed before reconcile, never reconciled directly).
export const RECONCILE_IN_FLIGHT_STATUSES: readonly DeploymentStatus[] = ['deploying', 'canceling'];
