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

	test('surfaces the failing RUN step block, not BuildKit’s generic "failed to solve" trailer', () => {
		const log = [
			'#9 [stage-0 6/7] RUN pnpm run build',
			'#9 11.284 ERROR  Nuxt Build Error: src/pages/index.vue:12:3 - Cannot find name ‘foo’.',
			'#9 ERROR: process "/bin/bash -ol pipefail -c pnpm run build" did not complete successfully: exit code: 1',
			'------',
			' > [stage-0 6/7] RUN pnpm run build:',
			'0.598 > my-app@1.0.0 build /app',
			'0.598 > nuxt build',
			'11.284 ERROR  Nuxt Build Error: src/pages/index.vue:12:3 - Cannot find name ‘foo’.',
			'11.512 ELIFECYCLE  Command failed with exit code 1.',
			'------',
			'Dockerfile:24',
			'--------------------',
			'  23 |     ',
			'  24 | >>> RUN pnpm run build',
			'  25 |     ',
			'--------------------',
			'ERROR: failed to solve: process "/bin/bash -ol pipefail -c pnpm run build" did not complete successfully: exit code: 1'
		].join('\n');
		const out = summarizeBuildLog(log);
		expect(out).toContain('RUN pnpm run build');
		expect(out).toContain('Nuxt Build Error');
		expect(out).toContain('ELIFECYCLE');
		expect(out).not.toContain('failed to solve');
		expect(out).not.toContain('Dockerfile:24');
	});

	test('skips the generic BuildKit trailer when no fenced block is present', () => {
		const log = [
			'#12 45.1 ERROR  Type error: Property does not exist.',
			'ERROR: failed to solve: process "/bin/bash -ol pipefail -c pnpm run build" did not complete successfully: exit code: 1'
		].join('\n');
		const out = summarizeBuildLog(log);
		expect(out).toContain('Type error');
		expect(out).not.toContain('failed to solve');
	});
});
