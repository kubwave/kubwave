import { Injectable } from '@nestjs/common';
import { loadBundledCatalog, type Catalog, type CatalogTemplate } from '@kubwave/templates';
import { SettingsService } from '../../shared/settings/settings.service.js';
import { TEMPLATE_CATALOG_SETTINGS_KEY, type TemplateCatalogState } from './template-catalog.refresh.js';

@Injectable()
export class TemplateCatalogService {
	constructor(private readonly settings: SettingsService) {}

	async getCatalog(): Promise<Catalog> {
		const state = await this.settings.get<TemplateCatalogState>(TEMPLATE_CATALOG_SETTINGS_KEY);
		if (state && state.catalog.length > 0) return state.catalog;
		return loadBundledCatalog();
	}

	async getTemplate(id: string): Promise<CatalogTemplate | null> {
		const catalog = await this.getCatalog();
		return catalog.find(t => t.id === id) ?? null;
	}
}
