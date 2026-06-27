import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDocument } from 'yaml';
import { templateSchema, catalogSchema, type CatalogTemplate } from './schema';
import { validateTemplateReferences } from './placeholders';

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, '..', 'templates');
const logosDir = join(here, '..', 'logos');
const catalogPath = join(here, '..', 'catalog.json');

export function assertSafeSvg(svg: string, name: string): void {
	if (/<script/i.test(svg)) throw new Error(`${name}: SVG contains <script>`);
	if (/<foreignObject/i.test(svg)) throw new Error(`${name}: SVG contains <foreignObject>`);
	if (/\son\w+\s*=/i.test(svg)) throw new Error(`${name}: SVG contains inline event handler`);
}

export function buildCatalog(): CatalogTemplate[] {
	const files = readdirSync(templatesDir)
		.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
		.sort();
	const seen = new Set<string>();
	const catalog: CatalogTemplate[] = [];

	for (const file of files) {
		const doc = parseDocument(readFileSync(join(templatesDir, file), 'utf8'));
		if (doc.errors.length > 0) throw new Error(`${file}: ${doc.errors.map(e => e.message).join('; ')}`);
		const template = templateSchema.parse(doc.toJS());
		const refErrors = validateTemplateReferences(template);
		if (refErrors.length > 0) throw new Error(`${file}: ${refErrors.join('; ')}`);
		if (seen.has(template.id)) throw new Error(`${file}: duplicate template id "${template.id}"`);
		seen.add(template.id);
		const logoSvg = readFileSync(join(logosDir, template.logo), 'utf8');
		assertSafeSvg(logoSvg, template.logo);
		catalog.push({ ...template, logoSvg });
	}

	return catalog.sort((a, b) => a.id.localeCompare(b.id));
}

function serialize(catalog: CatalogTemplate[]): string {
	return `${JSON.stringify(catalog, null, 2)}\n`;
}

// CLI: `bun run src/build-catalog.ts` writes catalog.json; `--check` fails if it is stale.
if (import.meta.main) {
	const catalog = catalogSchema.parse(buildCatalog());
	const next = serialize(catalog);
	if (process.argv.includes('--check')) {
		const current = (() => {
			try {
				return readFileSync(catalogPath, 'utf8');
			} catch {
				return '';
			}
		})();
		if (current !== next) {
			console.error('catalog.json is out of sync. Run: bun run --filter=@kubwave/templates build:catalog');
			process.exit(1);
		}
		console.log(`catalog.json in sync (${catalog.length} templates).`);
	} else {
		writeFileSync(catalogPath, next);
		console.log(`Wrote catalog.json (${catalog.length} templates).`);
	}
}
