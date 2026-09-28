import { readPageSource } from '@/lib/content';
import { flatNav } from '@/lib/nav';
import { sectionsFromMdx } from '@/lib/search-index';

export const dynamic = 'force-static';

// Emitted as a static /search.json; the search dialog fetches it on first open.
export async function GET() {
	const sections = await Promise.all(flatNav.map(async entry => sectionsFromMdx(entry, await readPageSource(entry.path))));
	return Response.json(sections.flat());
}
