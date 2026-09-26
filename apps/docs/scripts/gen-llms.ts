import { flatDocsNav } from '../app/utils/navigation';

export type LlmsPage = { path: string; title: string; description: string; body: string };

export const PAGE_DELIMITER = '\n\n<<<kubwave-doc>>>\n\n';

function frontmatter(text: string): { attrs: Record<string, string>; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	const attrs: Record<string, string> = {};
	for (const line of match?.[1].split('\n') ?? []) {
		const field = /^(\w+): (.*)$/.exec(line);
		if (field) attrs[field[1]] = field[2];
	}
	return { attrs, body: text.slice(match ? match[0].length : 0).trim() };
}

async function resolveContentFile(route: string): Promise<string> {
	const candidates = route === '/' ? ['content/index.md'] : [`content${route}.md`, `content${route}/index.md`];
	for (const candidate of candidates) {
		if (await Bun.file(candidate).exists()) return candidate;
	}
	throw new Error(`missing content file for route ${route}`);
}

export async function collectPages(): Promise<LlmsPage[]> {
	const routes = ['/', ...flatDocsNav().map(item => item.path)];
	const pages: LlmsPage[] = [];
	for (const route of routes) {
		const { attrs, body } = frontmatter(await Bun.file(await resolveContentFile(route)).text());
		pages.push({ path: route, title: attrs.title ?? route, description: attrs.description ?? '', body });
	}
	return pages;
}

export function buildLlms(pages: LlmsPage[]): { index: string; full: string } {
	const index = [
		'',
		'# kubwave docs',
		'',
		'Self-hosted kubwave control plane documentation.',
		'',
		...pages.map(page => `- [${page.title}](${page.path}): ${page.description}`),
		''
	].join('\n');
	const full = pages.map(page => `# ${page.title}\npath: ${page.path}\ndescription: ${page.description}\n\n${page.body}`).join(PAGE_DELIMITER) + '\n';
	return { index, full };
}

if (import.meta.main) {
	const pages = await collectPages();
	const { index, full } = buildLlms(pages);
	await Bun.write('public/llms.txt', index);
	await Bun.write('public/llms-full.txt', full);
	console.log(`llms: ${pages.length} pages`);
}
