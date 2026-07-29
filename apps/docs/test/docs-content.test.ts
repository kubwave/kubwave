import { describe, expect, test } from 'bun:test';
import { flatDocsNav } from '../app/utils/navigation';

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
});
