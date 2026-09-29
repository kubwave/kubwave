interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	prerelease: string[];
}

function parseVersion(version: string | null): ParsedVersion | null {
	const match = version?.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
	if (!match) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]?.split('.') ?? []
	};
}

function comparePrerelease(a: string[], b: string[]): number {
	if (a.length === 0 && b.length === 0) return 0;
	if (a.length === 0) return 1;
	if (b.length === 0) return -1;

	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const left = a[i];
		const right = b[i];
		if (left === undefined) return -1;
		if (right === undefined) return 1;
		if (left === right) continue;

		const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
		const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
		if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
		if (leftNumber !== null) return -1;
		if (rightNumber !== null) return 1;
		return left < right ? -1 : 1;
	}

	return 0;
}

export function compareVersions(a: string, b: string): number | null {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return null;

	for (const key of ['major', 'minor', 'patch'] as const) {
		const diff = left[key] - right[key];
		if (diff !== 0) return diff;
	}

	return comparePrerelease(left.prerelease, right.prerelease);
}

export function isNewerVersion(version: string, currentVersion: string | null | undefined): boolean {
	if (!currentVersion) return false;
	const diff = compareVersions(version, currentVersion);
	return diff !== null && diff > 0;
}
