process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/test';

import { describe, expect, test } from 'bun:test';
import type { SettingsService } from '~/shared/settings/settings.service';

const { TemplateCatalogService } = await import('~/modules/templates/template-catalog.service');
const { TEMPLATE_CATALOG_SETTINGS_KEY } = await import('~/modules/templates/template-catalog.refresh');

function settingsStub(value: unknown): SettingsService {
	return { get: async (k: string) => (k === TEMPLATE_CATALOG_SETTINGS_KEY ? value : null), set: async () => {} } as unknown as SettingsService;
}

describe('TemplateCatalogService', () => {
	test('falls back to the bundled catalog when settings are empty', async () => {
		const svc = new TemplateCatalogService(settingsStub(null));
		const catalog = await svc.getCatalog();
		const ids = catalog.map(t => t.id);
		expect(ids).toContain('ghost');
		expect(ids).toContain('supabase');
		expect(ids).toContain('uptime-kuma');
	});
	test('getTemplate returns null for an unknown id', async () => {
		const svc = new TemplateCatalogService(settingsStub(null));
		expect(await svc.getTemplate('nope')).toBeNull();
	});
});
