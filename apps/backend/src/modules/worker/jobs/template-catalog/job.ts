import { env } from '../../../../shared/config/worker-env.js';
import { getSetting, setSetting } from '../../../../shared/worker-common/settings.js';
import { refreshTemplateCatalog } from '../../../templates/template-catalog.refresh.js';

export async function runTemplateCatalogPoll(): Promise<void> {
	const result = await refreshTemplateCatalog({
		sourceUrl: env.templateCatalogUrl,
		get: getSetting,
		set: setSetting
	});
	if (result.status !== 'ok' && result.status !== 'not-modified') {
		console.warn(`[template-catalog-poller] ${result.status} (${env.templateCatalogUrl})`);
	}
}
