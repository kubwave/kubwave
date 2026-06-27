import { describe, expect, test } from 'bun:test';
import { buildCacheRef, buildImageRef, summarizeBuildLog } from '~/modules/worker/jobs/deployments/builds/service';

describe('buildCacheRef', () => {
	test('scopes the BuildKit registry cache under the per-env/per-service image repo', () => {
		expect(buildCacheRef('reg:5000', 'e1', 'abc')).toBe('reg:5000/env-e1/svc-abc:buildcache');
	});

	test('shares the image-ref repo path with a reserved cache tag', () => {
		const image = buildImageRef('reg:5000', 'e1', 'abc', 'dep-9');
		const cache = buildCacheRef('reg:5000', 'e1', 'abc');
		expect(cache).toBe(`${image.split(':').slice(0, -1).join(':')}:buildcache`);
	});
});

describe('summarizeBuildLog', () => {
	test('surfaces the Error line, not the trailing usage flag dump', () => {
		const log = [
			'Error: error resolving dockerfile path: please provide a valid path to a Dockerfile within the build context with --dockerfile',
			'Usage:',
			'  executor [flags]',
			'  executor [command]',
			'',
			'      --dockerfile string   Path to the dockerfile to be built.',
			'      --frontend string     Frontend to use.',
			'      --verbosity string    Log level'
		].join('\n');
		const out = summarizeBuildLog(log);
		expect(out).toBe(
			'Error: error resolving dockerfile path: please provide a valid path to a Dockerfile within the build context with --dockerfile'
		);
		expect(out).not.toContain('--frontend');
		expect(out).not.toContain('Usage:');
	});

	test('drops a trailing cobra usage block when there is no explicit Error line', () => {
		const log = ['some build output', 'more output', 'Usage:', '  executor [flags]', '      --flag string  noise'].join('\n');
		const out = summarizeBuildLog(log);
		expect(out).toContain('some build output');
		expect(out).not.toContain('--flag');
	});

	test('tails a normal multi-line build error', () => {
		const log = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
		const out = summarizeBuildLog(log);
		expect(out).toContain('line 29');
		expect(out).not.toContain('line 0');
	});
});
