import type * as k8s from '@kubernetes/client-node';

export interface ContainerLogTarget {
	name: string;
	failed: boolean;
	readable: boolean;
	complete: boolean;
	reason?: string;
	message?: string;
}

export function planContainerLogs(pod: k8s.V1Pod): ContainerLogTarget[] {
	const initNames = (pod.spec?.initContainers ?? []).map(container => container.name);
	const mainNames = (pod.spec?.containers ?? []).map(container => container.name);

	const statusByName = new Map<string, k8s.V1ContainerStatus>();
	for (const status of pod.status?.initContainerStatuses ?? []) statusByName.set(status.name, status);
	for (const status of pod.status?.containerStatuses ?? []) statusByName.set(status.name, status);

	return [...initNames, ...mainNames].map(name => {
		const status = statusByName.get(name);
		const reason = containerFailureReason(status);
		return {
			name,
			failed: reason !== undefined,
			readable: hasReadableLogs(status),
			complete: isContainerComplete(status),
			reason,
			message: containerMessage(status)
		};
	});
}

function containerFailureReason(status: k8s.V1ContainerStatus | undefined): string | undefined {
	if (!status) return undefined;

	const terminated = status.state?.terminated;
	if (terminated && (terminated.exitCode ?? 0) !== 0) {
		return terminated.reason ? `${terminated.reason} (exit ${terminated.exitCode})` : `exit ${terminated.exitCode}`;
	}

	const waiting = status.state?.waiting;
	if (waiting?.reason && /BackOff|Err|Invalid|Failed/i.test(waiting.reason)) return waiting.reason;
	return undefined;
}

function hasReadableLogs(status: k8s.V1ContainerStatus | undefined): boolean {
	if (!status) return false;
	return Boolean(status.state?.running || status.state?.terminated || status.lastState?.terminated);
}

function isContainerComplete(status: k8s.V1ContainerStatus | undefined): boolean {
	const terminated = status?.state?.terminated;
	return Boolean(terminated && (terminated.exitCode ?? 0) === 0);
}

function containerMessage(status: k8s.V1ContainerStatus | undefined): string | undefined {
	return status?.state?.terminated?.message ?? status?.state?.waiting?.message;
}
