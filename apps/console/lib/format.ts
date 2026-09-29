// Shared compact relative-time formatting so thresholds and wording stay consistent.
export function formatRelative(dateStr: string | null | undefined, fallback = 'recently'): string {
	if (!dateStr) return fallback;
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return fallback;

	const sec = Math.floor((Date.now() - date.getTime()) / 1000);
	if (sec < 60) return 'just now';
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.floor(hr / 24);
	if (day < 30) return `${day}d ago`;
	const mo = Math.floor(day / 30);
	if (mo < 12) return `${mo}mo ago`;
	return `${Math.floor(mo / 12)}yr ago`;
}

export function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
	if (!start) return '—';
	const startMs = new Date(start).getTime();
	const endMs = end ? new Date(end).getTime() : Date.now();
	const seconds = Math.max(0, Math.floor((endMs - startMs) / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
	if (bytes <= 0) return '0 B';
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	const exp = Math.min(Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0), units.length - 1);
	const value = bytes / 1024 ** exp;
	return `${value.toFixed(exp === 0 ? 0 : 1)} ${units[exp] ?? 'TiB'}`;
}

export function percentOf(used: number, total: number | null | undefined): number | null {
	if (!total || total <= 0) return null;
	return Math.min(100, Math.max(0, (used / total) * 100));
}

export function formatUptime(seconds: number | null | undefined): string {
	if (seconds == null || !Number.isFinite(seconds)) return '—';
	const total = Math.max(0, Math.floor(seconds));
	const days = Math.floor(total / 86_400);
	const hours = Math.floor((total % 86_400) / 3_600);
	const minutes = Math.floor((total % 3_600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${total}s`;
}

export function formatDateTime(input: string | null | undefined, fallback = '—'): string {
	if (!input) return fallback;
	const date = new Date(input);
	return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}
