export const TCP_PORT_POOL_SETTINGS_KEY = 'tcp-port-pool';
export const TCP_PORT_POOL_MIN_PORT = 1024;
export const TCP_PORT_POOL_MAX_SIZE = 100;

export interface TcpPortPoolSettings {
	enabled: boolean;
	start: number;
	size: number;
}

export const DEFAULT_TCP_PORT_POOL: TcpPortPoolSettings = { enabled: true, start: 30100, size: 20 };

export function resolveTcpPortPoolSettings(value: unknown, fallback: TcpPortPoolSettings = DEFAULT_TCP_PORT_POOL): TcpPortPoolSettings {
	const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<TcpPortPoolSettings>) : {};
	const resolved = {
		enabled: typeof v.enabled === 'boolean' ? v.enabled : fallback.enabled,
		start: typeof v.start === 'number' ? v.start : fallback.start,
		size: typeof v.size === 'number' ? v.size : fallback.size
	};
	return isValidTcpPortPoolSettings(resolved) ? resolved : fallback;
}

export function isValidTcpPortPoolSettings(value: TcpPortPoolSettings): boolean {
	return (
		Number.isInteger(value.start) &&
		Number.isInteger(value.size) &&
		value.start >= TCP_PORT_POOL_MIN_PORT &&
		value.start <= 65535 &&
		value.size >= 1 &&
		value.size <= TCP_PORT_POOL_MAX_SIZE &&
		value.start + value.size - 1 <= 65535
	);
}
