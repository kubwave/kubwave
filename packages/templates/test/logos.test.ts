import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertSafeSvg } from '../src/build-catalog';

const logosDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'logos');

describe('supabase logo', () => {
	test('exists and is a safe SVG', () => {
		const svg = readFileSync(join(logosDir, 'supabase.svg'), 'utf8');
		expect(svg).toContain('<svg');
		expect(() => assertSafeSvg(svg, 'supabase.svg')).not.toThrow();
	});
});
