import { describe, expect, it } from 'bun:test';
import { rewriteCrossRefs } from '~/modules/worker/jobs/pr-preview/rewrite';

describe('rewriteCrossRefs', () => {
	const mapping = {
		namespace: { from: 'kubwave-env-BASE', to: 'kubwave-env-PREVIEW' },
		services: new Map([['svc-aaa', 'svc-xxx']]),
		hosts: new Map([
			['docs-0820689f.kubwave.com', 'docs-3448ea31.kubwave.com'],
			['example.com', 'web-3448ea31.kubwave.com']
		])
	};
	it('rewrites svc-<id> and namespace occurrences', () => {
		const got = rewriteCrossRefs('postgres://svc-aaa.kubwave-env-BASE.svc.cluster.local:5432/db', mapping);
		expect(got).toBe('postgres://svc-xxx.kubwave-env-PREVIEW.svc.cluster.local:5432/db');
	});
	it('rewrites generated default-domain hosts inside URLs and comma-separated values', () => {
		const got = rewriteCrossRefs('https://docs-0820689f.kubwave.com,docs-0820689f.kubwave.com', mapping);
		expect(got).toBe('https://docs-3448ea31.kubwave.com,docs-3448ea31.kubwave.com');
	});
	it('leaves unrelated values untouched', () => {
		expect(rewriteCrossRefs('https://other.org', mapping)).toBe('https://other.org');
	});
	it('rewrites a custom-domain host in URLs, with ports and paths, case-insensitively', () => {
		expect(rewriteCrossRefs('https://Example.com:443/api/v1', mapping)).toBe('https://web-3448ea31.kubwave.com:443/api/v1');
	});
	it('does not rewrite a host inside a longer host or an email address', () => {
		for (const value of ['https://api.example.com', 'https://notexample.com', 'example.com.au', 'noreply@example.com', 'my-example.com']) {
			expect(rewriteCrossRefs(value, mapping)).toBe(value);
		}
	});
	it('rewrites multiple service ids in one value', () => {
		const m = {
			namespace: mapping.namespace,
			services: new Map([
				['svc-aaa', 'svc-xxx'],
				['svc-bbb', 'svc-yyy']
			])
		};
		expect(rewriteCrossRefs('svc-aaa,svc-bbb', m)).toBe('svc-xxx,svc-yyy');
	});
});
