import type { V1Job } from '@kubernetes/client-node';
import { BUILD_PROTOCOL_VERSION, AGENT_LEASE_SECONDS } from '@kubwave/build-protocol';
import type { BuildSettings } from './settings.js';

export function applyBuildResources(job: V1Job, settings: BuildSettings): void {
	const pod = job.spec?.template.spec;
	if (!pod) throw new Error('Build job has no pod specification');
	for (const container of [...(pod.initContainers ?? []), ...pod.containers]) {
		container.resources = {
			requests: { memory: settings.memoryRequest, ...(settings.cpuRequest ? { cpu: settings.cpuRequest } : {}) },
			limits: { memory: settings.memoryLimit, ...(settings.cpuLimit ? { cpu: settings.cpuLimit } : {}) }
		};
	}
	job.spec!.activeDeadlineSeconds = settings.timeoutSeconds;
}

export function agentAvailable(
	agent: {
		paused: boolean;
		revoked: boolean;
		protocolVersion: number | null;
		architecture: string | null;
		lastSeenAt: Date | null;
		capabilities: { dockerReady: boolean; freeDiskBytes: number } | null;
	},
	architecture: string,
	now = Date.now()
): boolean {
	return (
		!agent.paused &&
		!agent.revoked &&
		agent.protocolVersion === BUILD_PROTOCOL_VERSION &&
		agent.architecture === architecture &&
		Boolean(
			agent.lastSeenAt &&
			now - agent.lastSeenAt.getTime() < AGENT_LEASE_SECONDS * 1000 &&
			agent.capabilities?.dockerReady &&
			agent.capabilities.freeDiskBytes > 1024 ** 3
		)
	);
}

export function attemptImageRef(imageRef: string, runId: string, attempt: number): string {
	return `${imageRef}-${runId}-${attempt}`;
}
