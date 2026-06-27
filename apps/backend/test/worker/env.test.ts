import { describe, expect, test } from 'bun:test';

import { resolveBuildEngine } from '~/shared/config/worker-env';

describe('resolveBuildEngine', () => {
	test('defaults to buildkit and accepts buildkit', () => {
		expect(resolveBuildEngine(undefined)).toBe('buildkit');
		expect(resolveBuildEngine('')).toBe('buildkit');
		expect(resolveBuildEngine('buildkit')).toBe('buildkit');
	});

	test('rejects unsupported engines', () => {
		expect(() => resolveBuildEngine('kaniko')).toThrow('BUILD_ENGINE=kaniko is not supported');
	});
});
