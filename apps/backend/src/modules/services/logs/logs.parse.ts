import type { ServiceLogEntryDto } from './logs.dto.js';

export function parsePodLog(raw: string, pod: string): ServiceLogEntryDto[] {
	if (!raw) return [];

	const entries: ServiceLogEntryDto[] = [];
	for (const line of raw.split('\n')) {
		if (line.length === 0) continue;

		const space = line.indexOf(' ');
		const maybeTimestamp = space === -1 ? line : line.slice(0, space);

		if (space !== -1 && isRfc3339(maybeTimestamp)) {
			entries.push({ pod, timestamp: maybeTimestamp, message: line.slice(space + 1) });
		} else {
			entries.push({ pod, timestamp: null, message: line });
		}
	}

	return entries;
}

export function mergeAndSortEntries(groups: ServiceLogEntryDto[][]): ServiceLogEntryDto[] {
	return groups
		.flat()
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => {
			const aTime = a.entry.timestamp ? Date.parse(a.entry.timestamp) : Infinity;
			const bTime = b.entry.timestamp ? Date.parse(b.entry.timestamp) : Infinity;
			if (aTime !== bTime) return aTime - bTime;
			return a.index - b.index;
		})
		.map(item => item.entry);
}

function isRfc3339(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
	return !Number.isNaN(Date.parse(value));
}
