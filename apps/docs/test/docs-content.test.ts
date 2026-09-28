import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { flatNav } from '../lib/nav';

const contentFile = (path: string) => `content${path}.mdx`;

async function contentPaths(): Promise<string[]> {
	const files = await Array.fromAsync(new Glob('**/*.mdx').scan('content'));
	return files.map(file => `/${file.replace(/\.mdx$/, '')}`).sort();
}

describe('docs content', () => {
	test('has an MDX file for every sidebar entry', async () => {
		for (const { path } of flatNav) {
			expect(await Bun.file(contentFile(path)).exists()).toBe(true);
		}
	});

	test('lists every MDX file in the sidebar, so no page is orphaned', async () => {
		expect(await contentPaths()).toEqual(flatNav.map(item => item.path).sort());
	});

	test('exports a title and description from every page', async () => {
		for (const { path } of flatNav) {
			const text = await Bun.file(contentFile(path)).text();
			expect(text).toMatch(/^export const metadata = \{[\s\S]*?title:\s*['"].+?['"],[\s\S]*?description:\s*['"].+?['"]/);
		}
	});

	test('contains no leftover Nuxt MDC directives or Starlight imports', async () => {
		for (const { path } of flatNav) {
			const text = await Bun.file(contentFile(path)).text();
			expect(text).not.toMatch(/^\s*:{2,}[a-z-]*/m);
			expect(text).not.toMatch(/@astrojs\/starlight/);
		}
	});

	test('never hardcodes the install command, which depends on the docs channel', async () => {
		for (const { path } of flatNav) {
			expect(await Bun.file(contentFile(path)).text()).not.toMatch(/get\.kubwave\.com/);
		}
	});
});
