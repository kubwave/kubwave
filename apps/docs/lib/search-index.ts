import GithubSlugger from 'github-slugger';

export type SearchPage = { path: string; title: string; group: string };
export type SearchSection = { href: string; page: string; group: string; title: string; text: string };

type Draft = { href: string; title: string; lines: string[] };

const metadataExport = /^export const metadata = \{[\s\S]*?\};\s*/;
const headingLine = /^(#{1,6})\s+(.+?)\s*$/;
const fenceLine = /^\s*(`{3,}|~{3,})/;
const jsxTagLine = /^\s*<\/?[A-Z][^>]*>\s*$/;
const tableDivider = /^\s*\|?\s*:?-{3,}/;

// Rendered text of inline Markdown (links, escapes, emphasis, code spans).
function inlineText(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\\([\\{}<>|`*_[\]])/g, '$1')
		.replace(/[*`]/g, '')
		.trim();
}

// Rendered text of one block-level Markdown line: drops JSX tags, list markers and table syntax.
function plainText(line: string): string {
	if (jsxTagLine.test(line) || tableDivider.test(line)) return '';
	return inlineText(line.replace(/^\s*(?:[-*>]|\d+\.)\s+/, '').replace(/\|/g, ' '));
}

function toSection(page: SearchPage, draft: Draft): SearchSection {
	const text = draft.lines.join(' ').replace(/\s+/g, ' ').trim();
	return { href: draft.href, page: page.title, group: page.group, title: draft.title, text };
}

// Splits one MDX page into h2/h3 sections. Slugs come from the same slugger rehype-slug
// uses, counted over every heading level, so each href lands on the rendered anchor.
export function sectionsFromMdx(page: SearchPage, source: string): SearchSection[] {
	const slugger = new GithubSlugger();
	const drafts: Draft[] = [{ href: `${page.path}/`, title: page.title, lines: [] }];
	let inFence = false;

	for (const line of source.replace(metadataExport, '').split('\n')) {
		const current = drafts.at(-1)!;
		if (fenceLine.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			current.lines.push(line);
			continue;
		}
		const heading = headingLine.exec(line);
		if (!heading) {
			current.lines.push(plainText(line));
			continue;
		}
		const title = inlineText(heading[2]!);
		const slug = slugger.slug(title);
		if (heading[1]!.length === 2 || heading[1]!.length === 3) drafts.push({ href: `${page.path}/#${slug}`, title, lines: [] });
		else current.lines.push(title);
	}

	return drafts.map(draft => toSection(page, draft)).filter(section => section.text !== '');
}
