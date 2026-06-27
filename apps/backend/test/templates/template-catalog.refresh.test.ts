import { describe, expect, test } from 'bun:test';
import { refreshTemplateCatalog, TEMPLATE_CATALOG_SETTINGS_KEY, type TemplateCatalogState } from '~/modules/templates/template-catalog.refresh';

function entry(id: string, schemaVersion = 1) {
	return {
		id,
		name: id,
		description: id,
		category: 'x',
		tags: [],
		logo: `${id}.svg`,
		logoSvg: '<svg/>',
		documentation: 'https://x.test',
		schemaVersion,
		version: 1,
		inputs: [],
		secrets: [],
		services: [
			{
				name: id,
				primary: true,
				type: 'docker-image' as const,
				config: { image: id, tag: '1', containerPort: 80, env: [], secrets: [], domains: [], volumes: [], configFiles: [] }
			}
		]
	};
}

function store() {
	const map = new Map<string, unknown>();
	return { map, get: async <T>(k: string) => (map.has(k) ? (map.get(k) as T) : null), set: async <T>(k: string, v: T) => void map.set(k, v) };
}

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}) {
	const headers = new Headers();
	if (init.etag) headers.set('etag', init.etag);
	return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

describe('refreshTemplateCatalog', () => {
	test('stores a fetched catalog and the etag', async () => {
		const s = store();
		const fetchFn = (async () => jsonResponse([entry('a')], { etag: 'W/"1"' })) as unknown as typeof fetch;
		const res = await refreshTemplateCatalog({ sourceUrl: 'https://x/catalog.json', get: s.get, set: s.set, fetchFn });
		expect(res.count).toBe(1);
		const state = s.map.get(TEMPLATE_CATALOG_SETTINGS_KEY) as TemplateCatalogState;
		expect(state.catalog.map(t => t.id)).toEqual(['a']);
		expect(state.lastEtag).toBe('W/"1"');
	});

	test('skips entries with an unknown schemaVersion, keeps the rest', async () => {
		const s = store();
		const fetchFn = (async () => jsonResponse([entry('a'), entry('future', 999)])) as unknown as typeof fetch;
		const res = await refreshTemplateCatalog({ sourceUrl: 'https://x', get: s.get, set: s.set, fetchFn });
		expect(res.count).toBe(1);
	});

	test('304 keeps the previously stored catalog', async () => {
		const s = store();
		await s.set(TEMPLATE_CATALOG_SETTINGS_KEY, { catalog: [entry('a')], lastEtag: 'W/"1"', lastCheckedAt: null } satisfies TemplateCatalogState);
		const fetchFn = (async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
		await refreshTemplateCatalog({ sourceUrl: 'https://x', get: s.get, set: s.set, fetchFn });
		const state = s.map.get(TEMPLATE_CATALOG_SETTINGS_KEY) as TemplateCatalogState;
		expect(state.catalog.map(t => t.id)).toEqual(['a']);
	});

	test('invalid JSON keeps the previously stored catalog', async () => {
		const s = store();
		await s.set(TEMPLATE_CATALOG_SETTINGS_KEY, { catalog: [entry('a')], lastEtag: null, lastCheckedAt: null } satisfies TemplateCatalogState);
		const fetchFn = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
		await refreshTemplateCatalog({ sourceUrl: 'https://x', get: s.get, set: s.set, fetchFn });
		const state = s.map.get(TEMPLATE_CATALOG_SETTINGS_KEY) as TemplateCatalogState;
		expect(state.catalog.map(t => t.id)).toEqual(['a']);
	});
});
