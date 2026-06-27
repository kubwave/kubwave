import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { catalogSchema, type Catalog } from './schema';

export * from './schema';
export * from './placeholders';

const catalogPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'catalog.json');

// Offline / cold-start fallback: the catalog bundled into the backend image at build time.
export function loadBundledCatalog(): Catalog {
	return catalogSchema.parse(JSON.parse(readFileSync(catalogPath, 'utf8')));
}
