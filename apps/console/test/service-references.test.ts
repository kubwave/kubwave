import { describe, expect, test } from 'bun:test';
import { insertReference, referenceQueryBefore, referenceSuggestions } from '../app/utils/service-references';

describe('referenceQueryBefore', () => {
	test('returns the partial expression typed after `${{`', () => {
		expect(referenceQueryBefore('postgres://u:p@${{serv')).toEqual({ start: 15, query: 'serv' });
		expect(referenceQueryBefore('${{')).toEqual({ start: 0, query: '' });
	});

	test('is null outside a reference or after it was closed', () => {
		expect(referenceQueryBefore('https://example.com')).toBeNull();
		expect(referenceQueryBefore('${{services.api.url}}/v1')).toBeNull();
		expect(referenceQueryBefore('{{ inputs.url')).toBeNull();
	});
});

describe('referenceSuggestions', () => {
	test('offers every property of every service, written without spaces', () => {
		const suggestions = referenceSuggestions(['api', 'db'], '');
		expect(suggestions).toHaveLength(10);
		expect(suggestions[0]).toMatchObject({ label: 'services.api.host', insert: '${{services.api.host}}' });
	});

	test('filters by what was typed anywhere in the expression', () => {
		expect(referenceSuggestions(['api', 'db'], 'db.p').map(s => s.label)).toEqual(['services.db.port']);
		expect(referenceSuggestions(['api', 'db'], 'services.api.u').map(s => s.label)).toEqual(['services.api.url']);
		expect(referenceSuggestions(['api'], ' API.URL ').map(s => s.label)).toEqual(['services.api.url']);
	});
});

describe('insertReference', () => {
	test('replaces the partial reference and puts the caret after it', () => {
		expect(insertReference('postgres://u:p@${{db.h/app', 15, 22, '${{services.db.host}}')).toEqual({
			text: 'postgres://u:p@${{services.db.host}}/app',
			caret: 36
		});
	});

	test('swallows closing braces that were already typed', () => {
		expect(insertReference('${{}}', 0, 3, '${{services.api.url}}')).toEqual({ text: '${{services.api.url}}', caret: 21 });
	});
});
