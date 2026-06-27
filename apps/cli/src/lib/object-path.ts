// Read-only helpers for walking untyped object trees (Helm values, marker JSON, etc).

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeObjects(...objects: Record<string, unknown>[]): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const object of objects) {
		for (const [key, value] of Object.entries(object)) {
			const existing = result[key];
			result[key] = isRecord(existing) && isRecord(value) ? mergeObjects(existing, value) : value;
		}
	}
	return result;
}

export function readPath(root: unknown, path: string[]): unknown {
	let current = root;
	for (const key of path) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return current;
}

export function readString(root: unknown, path: string[]): string | undefined {
	const value = readPath(root, path);
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readBool(root: unknown, path: string[]): boolean | undefined {
	const value = readPath(root, path);
	return typeof value === 'boolean' ? value : undefined;
}

export function readRecord(root: unknown, path: string[]): Record<string, unknown> | undefined {
	const value = readPath(root, path);
	return isRecord(value) ? value : undefined;
}

export function readStringMap(root: unknown, path: string[]): Record<string, string> | undefined {
	const value = readPath(root, path);
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
