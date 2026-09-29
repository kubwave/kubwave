import { parseAnsi, type AnsiSegment } from './ansi';

// Merges per-container build log streams (prepare → nixpacks → builder) into one ANSI-parsed list.
// `showDivider` marks each phase's first line; single-phase builds get no dividers.

export type BuildLogLine = { container: string; segments: AnsiSegment[]; showDivider: boolean };

// Run order of the build pod's containers; anything unexpected sorts last.
const RUN_ORDER: Record<string, number> = { prepare: 0, nixpacks: 1, builder: 2 };

function rank(name: string): number {
	return name in RUN_ORDER ? RUN_ORDER[name]! : 99;
}

export function buildLogLines(containers: { containerName: string; content: string }[]): BuildLogLine[] {
	const ordered = [...containers].sort((a, b) => rank(a.containerName) - rank(b.containerName) || a.containerName.localeCompare(b.containerName));
	const multiPhase = ordered.length > 1;
	const lines: BuildLogLine[] = [];
	for (const container of ordered) {
		container.content.split('\n').forEach((line, index) => {
			lines.push({ container: container.containerName, segments: parseAnsi(line), showDivider: multiPhase && index === 0 });
		});
	}
	return lines;
}
