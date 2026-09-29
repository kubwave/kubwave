import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type PageMetadata = { title: string; description: string };
export type PageModule = { default: React.ComponentType; metadata: PageMetadata };

// Server-only: the dynamic import pulls every page into whichever bundle imports this.
export async function loadPage(path: string): Promise<PageModule> {
	return import(`@/content/${path.slice(1)}.mdx`);
}

export function readPageSource(path: string): Promise<string> {
	return readFile(join(process.cwd(), 'content', `${path}.mdx`), 'utf8');
}
