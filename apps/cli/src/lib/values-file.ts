import { mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';

// Write a Helm values document (string or object) to a throwaway temp file and return its path.
export function writeValuesFile(prefix: string, values: Record<string, unknown> | string): string {
	const tmpDir = mkdtempSync(resolve(tmpdir(), prefix));
	const valuesPath = resolve(tmpDir, 'values.yaml');
	writeFileSync(valuesPath, typeof values === 'string' ? values : stringify(values));
	return valuesPath;
}
