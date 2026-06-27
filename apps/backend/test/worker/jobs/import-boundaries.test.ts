import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The `~/*` alias is a test-only convenience (wired via tsconfig `paths` for the test runner).
// Production source under src/ must use relative `.js` specifiers — an alias import there would
// only resolve under the test runner, not the built app. This guards that boundary.
const srcRoot = fileURLToPath(new URL('../../../src', import.meta.url));

function tsFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...tsFiles(path));
		else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
	}
	return files;
}

describe('import boundaries', () => {
	test('source uses relative imports, never the test-only ~/ alias', () => {
		const offenders = tsFiles(srcRoot).filter(file => /from\s+['"]~\/|import\(['"]~\//.test(readFileSync(file, 'utf8')));
		expect(offenders.map(file => relative(srcRoot, file))).toEqual([]);
	});
});
