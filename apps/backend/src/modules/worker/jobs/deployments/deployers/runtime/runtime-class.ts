import { isDatabaseEngine } from '@kubwave/db/database-engines';

// Sandbox-runtime decision by PROVENANCE, never by inspecting the workload (a tenant could fake "looks like a DB").
// Managed DatabaseEngine services are exempt (isolated by namespace + NetworkPolicy); all user-supplied workloads get the default sandbox.
export function runtimeClassForService(serviceType: string, defaultClass: string): string {
	if (isDatabaseEngine(serviceType)) return '';
	return defaultClass;
}
