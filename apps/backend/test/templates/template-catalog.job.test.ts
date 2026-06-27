import { describe, expect, mock, test } from 'bun:test';
import { env } from '~/shared/config/worker-env';

mock.module('~/shared/worker-common/settings', () => ({
	getSetting: async () => null,
	setSetting: async () => {}
}));

describe('template catalog config', () => {
	test('defaults the catalog URL to the raw github catalog.json', () => {
		expect(env.templateCatalogUrl).toBe('https://raw.githubusercontent.com/kubwave/kubwave/main/packages/templates/catalog.json');
	});
	test('defaults the poll interval to 30 minutes', () => {
		expect(env.templateCatalogPollIntervalMs).toBe(1_800_000);
	});
	test('runTemplateCatalogPoll is exported', async () => {
		const { runTemplateCatalogPoll } = await import('~/modules/worker/jobs/template-catalog/job');
		expect(typeof runTemplateCatalogPoll).toBe('function');
	});
});
