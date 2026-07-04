export function parseDurationMs(raw: string | undefined): number | undefined {
	const m = raw?.trim().match(/^(\d+)(m|s)?$/);
	if (!m) return undefined;
	const n = parseInt(m[1] ?? '', 10);
	return m[2] === 's' ? n * 1000 : n * 60 * 1000;
}
