export const privateRepoSshUrlMessage = 'Enter an SSH Git URL (e.g. git@github.com:org/repo.git or ssh://git@host:2222/org/repo.git).';

export function isPrivateRepoSshUrl(value: string): boolean {
	const raw = value.trim();
	if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+$/.test(raw)) return true;
	if (!raw.startsWith('ssh://')) return false;
	if (/^ssh:\/\/[^/\s]+:(?=\/)/.test(raw)) return false;

	try {
		const url = new URL(raw);
		if (url.protocol !== 'ssh:' || !url.hostname || !url.pathname || url.pathname === '/') return false;
		if (!url.port) return true;
		const port = Number(url.port);
		return Number.isInteger(port) && port >= 1 && port <= 65535;
	} catch {
		return false;
	}
}
