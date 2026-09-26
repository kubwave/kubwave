import { ApiError } from '../../shared/errors/api-error.js';

export type DocPage = { path: string; title: string; description: string; body: string };

const PAGE_DELIMITER = '\n\n<<<kubwave-doc>>>\n\n';
const CACHE_TTL_MS = 10 * 60_000;

let cache: { at: number; pages: DocPage[] } | null = null;

export function parseDocs(full: string): DocPage[] {
	return full
		.split(PAGE_DELIMITER)
		.map(chunk => {
			const header = /^# (.+)\npath: (\S+)\ndescription: (.*)\n/.exec(chunk);
			if (!header) return null;
			return { title: header[1], path: header[2], description: header[3], body: chunk.slice(header[0].length).trim() };
		})
		.filter((page): page is DocPage => page !== null);
}

export function searchDocs(pages: DocPage[], query: string, limit = 10) {
	const q = query.toLowerCase();
	return pages
		.map(page => {
			if (!`${page.title}\n${page.description}\n${page.body}`.toLowerCase().includes(q)) return null;
			const matches = page.body
				.split('\n')
				.filter(line => line.toLowerCase().includes(q))
				.slice(0, 5);
			return { path: page.path, title: page.title, matches };
		})
		.filter((hit): hit is NonNullable<typeof hit> => hit !== null)
		.slice(0, limit);
}

export async function loadDocs(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<DocPage[]> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.pages;
	const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/llms-full.txt`);
	if (!response.ok) throw new ApiError(502, 'docs_unavailable');
	cache = { at: Date.now(), pages: parseDocs(await response.text()) };
	return cache.pages;
}
