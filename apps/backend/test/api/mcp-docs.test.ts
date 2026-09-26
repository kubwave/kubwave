import { describe, expect, test } from 'bun:test';
import { parseDocs, searchDocs } from '~/modules/mcp/mcp-docs';

const full = [
	'# Quickstart',
	'path: /start/quickstart',
	'description: Install kubwave in three steps.',
	'',
	'Install kubwave with the CLI.',
	'',
	'## Prerequisites',
	'',
	'- A Kubernetes cluster you can reach.',
	'',
	'<<<kubwave-doc>>>',
	'',
	'# Templates',
	'path: /templates',
	'description: Preconfigured application stacks.',
	'',
	'Supabase, Ghost, Uptime Kuma.'
].join('\n');

describe('mcp docs tools', () => {
	test('parses llms-full.txt pages', () => {
		const pages = parseDocs(full);
		expect(pages.map(page => [page.path, page.title])).toEqual([
			['/start/quickstart', 'Quickstart'],
			['/templates', 'Templates']
		]);
		expect(pages[0]?.description).toBe('Install kubwave in three steps.');
		expect(pages[0]?.body).toContain('Prerequisites');
	});

	test('search matches title, description and body, capped per page', () => {
		const pages = parseDocs(full);
		expect(searchDocs(pages, 'ghost').map(hit => hit.path)).toEqual(['/templates']);
		expect(searchDocs(pages, 'stack')[0]?.path).toBe('/templates');
		expect(searchDocs(pages, 'kubernetes')[0]?.matches).toEqual(['- A Kubernetes cluster you can reach.']);
		expect(searchDocs(pages, 'zzz')).toEqual([]);
		expect(searchDocs(pages, 'the', 1).length).toBe(1);
	});
});
