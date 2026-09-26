import { describe, expect, test } from 'bun:test';
import { buildInstallCommand } from '../app/utils/install-command';
import { flatDocsNav } from '../app/utils/navigation';
import { buildLlms, collectPages, PAGE_DELIMITER } from '../scripts/gen-llms';

const expectedRoutes = [
	'/',
	'/start/introduction',
	'/start/quickstart',
	'/start/supported-providers',
	'/start/architecture',
	'/providers/cloudfleet-hetzner',
	'/providers/cloudfleet-gcp',
	'/providers/upcloud-uks',
	'/providers/infomaniak-pck',
	'/guides/deploy-a-service',
	'/guides/configure-a-service',
	'/guides/tenant-isolation',
	'/guides/contributing-to-docs',
	'/templates',
	'/templates/supabase',
	'/templates/ghost',
	'/templates/uptime-kuma',
	'/reference/cli',
	'/reference/helm-chart',
	'/reference/environment-variables'
] as const;

const forbiddenPatterns = [/@astrojs\/starlight/, /<\/?(?:Aside|CardGrid|Card|LinkCard|Tabs|TabItem|Steps)\b/, /\{\/\*/] as const;

async function resolveContentFile(route: string): Promise<string | undefined> {
	const candidates = route === '/' ? ['content/index.md'] : [`content${route}.md`, `content${route}/index.md`];
	for (const candidate of candidates) {
		if (await Bun.file(candidate).exists()) return candidate;
	}
	return undefined;
}

describe('docs content conversion', () => {
	test('has every expected route as converted Markdown', async () => {
		for (const route of expectedRoutes) {
			expect(await resolveContentFile(route)).toBeDefined();
		}
	});

	test('keeps sidebar order aligned with the converted routes', () => {
		expect(flatDocsNav().map(item => item.path)).toEqual(expectedRoutes.filter(route => route !== '/'));
	});

	test('removes Starlight imports and raw JSX component tags', async () => {
		for (const route of expectedRoutes) {
			const file = await resolveContentFile(route);
			expect(file).toBeDefined();
			const text = await Bun.file(file!).text();
			for (const pattern of forbiddenPatterns) {
				expect(text).not.toMatch(pattern);
			}
		}
	});

	test('never hardcodes the install command in Markdown', async () => {
		for (const route of expectedRoutes) {
			const text = await Bun.file((await resolveContentFile(route))!).text();
			expect(text).not.toMatch(/get\.kubwave\.com/);
		}
	});
});

describe('llms build', () => {
	test('covers every route in nav order with title and description', async () => {
		const pages = await collectPages();
		expect(pages.map(page => page.path)).toEqual(expectedRoutes);
		for (const page of pages) {
			expect(page.title).not.toBe(page.path);
			expect(page.description).not.toBe('');
		}
		const { index, full } = buildLlms(pages);
		for (const route of expectedRoutes) {
			expect(full).toContain(`path: ${route}`);
		}
		expect(index).toContain('Quickstart');
		expect(full).toContain(PAGE_DELIMITER.trim());
	});
});

describe('install command', () => {
	test('adds the preview channel on the next docs build', () => {
		expect(buildInstallCommand('next')).toBe('curl -fsSL https://get.kubwave.com | bash -s -- --channel preview');
	});

	test('uses the script default on the stable docs build', () => {
		expect(buildInstallCommand('latest')).toBe('curl -fsSL https://get.kubwave.com | bash');
	});

	test('falls back to stable for unknown channels', () => {
		expect(buildInstallCommand('')).toBe(buildInstallCommand('latest'));
		expect(buildInstallCommand('edge')).toBe(buildInstallCommand('latest'));
	});
});
