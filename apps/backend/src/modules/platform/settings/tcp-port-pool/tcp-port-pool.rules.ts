import type { TcpPortPoolSettings } from '@kubwave/kube';

export function tcpPortPoolConflicts(pool: TcpPortPoolSettings, publicPorts: number[]): number[] {
	if (!pool.enabled) return publicPorts;

	const end = pool.start + pool.size - 1;
	return publicPorts.filter(port => port < pool.start || port > end);
}
