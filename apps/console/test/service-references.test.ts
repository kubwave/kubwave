import { describe, expect, test } from 'bun:test';
import { insertReference, previewReferences, referenceQueryBefore, referenceSuggestions } from '../lib/service-references';

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

describe('previewReferences', () => {
	const services = [
		{ name: 'api', internalDomain: 'svc-1', config: { containerPort: 3000, domains: [{ host: 'api.acme.dev', port: 3000 }] }, defaultUrl: null },
		{ name: 'db', internalDomain: 'svc-2', config: { containerPort: 5432, domains: [] }, defaultUrl: null }
	];

	test('resolves references to the values the platform injects', () => {
		expect(previewReferences('http://${{services.api.host}}:${{services.api.port}}', services)).toBe('http://svc-1:3000');
		expect(previewReferences('${{services.api.url}} ${{services.db.internalUrl}}', services)).toBe('https://api.acme.dev http://svc-2:5432');
	});

	test('leaves unknown services and properties untouched', () => {
		expect(previewReferences('${{services.nope.host}} ${{services.api.password}}', services)).toBe(
			'${{services.nope.host}} ${{services.api.password}}'
		);
	});

	test('has no preview without a public domain', () => {
		expect(previewReferences('${{services.db.domain}}', services)).toBe('${{services.db.domain}}');
	});
});
