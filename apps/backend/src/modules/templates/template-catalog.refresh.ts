import { catalogTemplateSchema, CURRENT_SCHEMA_VERSION, type Catalog } from '@kubwave/templates';

export const TEMPLATE_CATALOG_SETTINGS_KEY = 'template_catalog';

export interface TemplateCatalogState {
	catalog: Catalog;
	lastEtag: string | null;
	lastCheckedAt: string | null;
}

export interface RefreshDeps {
	sourceUrl: string;
	get: <T>(key: string) => Promise<T | null>;
	set: <T>(key: string, value: T) => Promise<void>;
	fetchFn?: typeof fetch;
}

const EMPTY: TemplateCatalogState = { catalog: [], lastEtag: null, lastCheckedAt: null };

// Mirrors PlatformVersionService.checkForUpdates: conditional GET (etag), tolerate failures by
// keeping the last good state, and validate per-entry so one bad/future template can't poison the catalog.
export async function refreshTemplateCatalog(deps: RefreshDeps): Promise<{ status: string; count: number }> {
	const fetchFn = deps.fetchFn ?? fetch;
	const state = (await deps.get<TemplateCatalogState>(TEMPLATE_CATALOG_SETTINGS_KEY)) ?? EMPTY;
	const now = new Date().toISOString();
	const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'kubwave-templates' };
	if (state.lastEtag) headers['If-None-Match'] = state.lastEtag;

	let response: Response;
	try {
		response = await fetchFn(deps.sourceUrl, { headers });
	} catch (err) {
		await deps.set(TEMPLATE_CATALOG_SETTINGS_KEY, { ...state, lastCheckedAt: now });
		return { status: `fetch-failed: ${err instanceof Error ? err.message : String(err)}`, count: state.catalog.length };
	}

	if (response.status === 304 || !response.ok) {
		await deps.set(TEMPLATE_CATALOG_SETTINGS_KEY, { ...state, lastCheckedAt: now });
		return { status: response.status === 304 ? 'not-modified' : `http-${response.status}`, count: state.catalog.length };
	}

	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch {
		await deps.set(TEMPLATE_CATALOG_SETTINGS_KEY, { ...state, lastCheckedAt: now });
		return { status: 'invalid-json', count: state.catalog.length };
	}

	if (!Array.isArray(parsed)) {
		await deps.set(TEMPLATE_CATALOG_SETTINGS_KEY, { ...state, lastCheckedAt: now });
		return { status: 'not-an-array', count: state.catalog.length };
	}

	const catalog: Catalog = [];
	for (const raw of parsed) {
		if (!raw || typeof raw !== 'object' || (raw as { schemaVersion?: unknown }).schemaVersion !== CURRENT_SCHEMA_VERSION) continue;
		const result = catalogTemplateSchema.safeParse(raw);
		if (result.success) catalog.push(result.data);
	}

	const etag = response.headers.get('etag');
	await deps.set(TEMPLATE_CATALOG_SETTINGS_KEY, { catalog, lastEtag: etag, lastCheckedAt: now });
	return { status: 'ok', count: catalog.length };
}
